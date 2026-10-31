# Kiến trúc ShopFast

Backend thương mại điện tử (NestJS, PostgreSQL, Redis) chạy trên một EC2. Quyết định chi tiết nằm ở [docs/adr/](adr/); tài liệu này cho cái nhìn tổng thể.

## Tổng thể trên AWS

```mermaid
flowchart TB
  user[Trình duyệt] -->|HTTPS, WebSocket| nginx

  subgraph ec2[EC2 Ubuntu, Docker Compose]
    subgraph edge[Mạng edge]
      nginx[Nginx<br/>TLS, web tĩnh, upstream]
      blue[api-blue]
      green[api-green]
      certbot[certbot<br/>mạng egress riêng]
    end
    subgraph backend[Mạng backend, internal]
      pg[(PostgreSQL 16)]
      redis[(Redis 7)]
    end
    nginx -->|màu đang active| blue
    nginx -.->|màu chờ| green
    blue --> pg
    blue --> redis
    green --> pg
    green --> redis
    cron[cron backup.sh]
  end

  blue -->|SMTP, LLM| ext[Gmail, nhà cung cấp LLM]
  cron -->|instance role| s3[(S3 backup)]

  subgraph gh[GitHub]
    actions[GitHub Actions]
  end
  actions -->|OIDC, credential tạm| iam[IAM role]
  iam -->|thêm/gỡ IP runner ở cổng 22| sg[Security Group]
  actions -->|SSH key bị khoá lệnh| ec2
```

Chỉ Nginx có `ports`. Mạng `backend` là `internal: true`, nên Postgres và Redis không có đường ra Internet.

Không dùng ECR và SSM: image đi thẳng từ runner vào máy qua SSH ([ADR-0014](adr/0014-oidc-va-cong-ssh-tam-thoi.md)).

## Luồng dữ liệu

### Đặt đơn

```mermaid
sequenceDiagram
  participant C as Khách
  participant A as API
  participant D as PostgreSQL
  participant R as Redis
  C->>A: POST /api/orders + Idempotency-Key
  A->>A: Có đơn cùng key? Trả lại đơn cũ
  A->>D: BEGIN
  A->>D: INSERT đơn (unique theo user + key)
  loop Từng dòng, productId tăng dần
    A->>D: UPDATE stock = stock - qty WHERE stock >= qty
  end
  alt Một dòng không đủ hàng
    A->>D: ROLLBACK
    A-->>C: 409 kèm details
  else Đủ hàng
    A->>D: COMMIT
    A->>R: product.updated xoá cache
    A-->>C: 201
  end
```

Mã: `orders.repository.ts:128` (sắp xếp), `:153-154` (trừ kho nguyên tử), `:207-208` (P2002, P2028). Chi tiết: [ADR-0005](adr/0005-khoa-ton-kho-khi-dat-hang.md).

### Cập nhật trạng thái đến realtime

```mermaid
sequenceDiagram
  participant W as Nhân viên kho
  participant A as Instance A
  participant D as PostgreSQL
  participant R as Redis pub/sub
  participant B as Instance B
  participant C as Khách
  W->>A: PATCH /api/orders/:id/status
  A->>A: assertTransition
  A->>D: UPDATE WHERE status = from + INSERT history
  A->>A: Phát order.status_changed sau commit
  A->>R: emit vào orderRoom(id)
  R->>B: Đồng bộ room
  B-->>C: order:updated
```

Compare-and-set ở `orders.repository.ts:226-227`. Khi nối lại, client subscribe lại và ack trả trạng thái mới nhất (`order-socket.ts:107`), bù sự kiện bị lỡ. Chi tiết: [ADR-0006](adr/0006-state-machine-don-hang.md), [ADR-0010](adr/0010-realtime-socketio-redis-adapter.md).

### Background job: email, hoá đơn, đồng bộ tồn kho

```mermaid
flowchart LR
  ev[Domain event sau commit] --> l[OrderJobsListener]
  l -->|jobId cố định| q[(BullMQ trên Redis)]
  q --> w[Worker]
  w -->|đọc lại DB, kiểm lại trạng thái| db[(PostgreSQL)]
  w --> e[email: deliverOnce rồi MailSender]
  w --> i[invoice: PDF vào volume]
  w --> s[inventory-sync]
  w -->|hết lượt thử hoặc UnrecoverableError| dl[(dead-letter)]
```

API không chờ job. `jobId` cố định chặn đẩy trùng (`queues.ts:72`), `deliverOnce` giành quyền trong `email_deliveries` trước khi gửi (`email-jobs.service.ts:99`). Chi tiết: [ADR-0009](adr/0009-background-jobs-bullmq.md).

### Agent AI gọi tool

```mermaid
sequenceDiagram
  participant N as Nhân viên CSKH
  participant A as SupportAgentService
  participant L as LLM_PROVIDER
  participant T as Tool
  participant P as PendingActionsService
  N->>A: POST /api/support/tickets/:id/assistant
  loop Tới khi có câu trả lời cuối
    A->>L: Prompt, ticket nằm trong thẻ dữ liệu
    L-->>A: Gọi getOrderStatus, checkStock, proposeCancelOrder hoặc proposeReturnRequest
    A->>T: Chạy bằng service nghiệp vụ, chỉ đọc hoặc tạo PendingAction
    T-->>A: Kết quả hoặc isError
  end
  A->>A: parseFinalAnswer + grounding
  A-->>N: Trả lời kèm đề xuất
  N->>P: POST /api/support/pending-actions/:id/confirm
  P->>P: CAS PENDING → EXECUTING, kiểm lại điều kiện, thực thi
```

Model không có tool ghi trực tiếp. CAS ở `pending-actions.repository.ts:115-122`. Chi tiết: [ADR-0011](adr/0011-ai-agent-human-in-the-loop.md).

### Deploy

```mermaid
flowchart TB
  push[Push main] --> ci[CI: lint, unit, e2e, docker]
  ci -->|xanh| build[Build image tag SHA trên runner]
  build --> open[OIDC, mở cổng 22 cho IP runner]
  open --> load[docker save qua SSH]
  load --> mig[deploy.sh: backup nếu có migration, migrate]
  mig --> up[Bật màu còn lại]
  up -->|không healthy sau 2 phút| keep[Dừng màu mới, giữ màu cũ, exit 1]
  up -->|healthy| sw[Đổi upstream, nginx reload]
  sw --> ver[Kiểm tra qua Nginx: đúng commit, 5 lần]
  ver -->|lỗi| rb[rollback.sh, exit 1]
  ver -->|đạt| drain[Drain 30 giây, dừng màu cũ, ghi last_good_sha]
  keep --> close[Luôn gỡ rule cổng 22]
  rb --> close
  drain --> close
```

Chi tiết và giới hạn: [ADR-0015](adr/0015-zero-downtime-va-gioi-han.md).

## Thành phần

| Thành phần                  | Dùng cho                          | Lý do chọn                                                                                                             | Phương án đã cân nhắc                                                            |
| --------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| NestJS 10                   | API                               | Module, DI, guard toàn cục mặc định từ chối                                                                            | Express thuần                                                                    |
| Prisma 6                    | ORM                               | Type an toàn, migration có kiểm soát ([ADR-0001](adr/0001-chon-orm-prisma.md))                                         | TypeORM, Drizzle, SQL thuần                                                      |
| PostgreSQL 16               | Dữ liệu chính                     | Transaction, CHECK, UPDATE nguyên tử                                                                                   | Giữ tồn kho ở Redis (đã loại, [ADR-0005](adr/0005-khoa-ton-kho-khi-dat-hang.md)) |
| Redis 7                     | Cache, rate limit, queue, pub/sub | Một thành phần cho nhiều nhu cầu, lỗi thì suy giảm được                                                                | Memcached, cache trong process                                                   |
| JWT + refresh xoay vòng     | Xác thực                          | Access ngắn hạn, phát hiện dùng lại refresh ([ADR-0003](adr/0003-quan-ly-refresh-token.md))                            | Session trên server                                                              |
| EventEmitter2               | Domain event                      | Tách listener, phát sau commit ([ADR-0004](adr/0004-domain-event-noi-bo.md))                                           | Outbox, Kafka                                                                    |
| BullMQ                      | Job nền                           | Retry, backoff, Bull Board ([ADR-0009](adr/0009-background-jobs-bullmq.md))                                            | Gọi đồng bộ, RabbitMQ                                                            |
| Socket.IO + Redis adapter   | Realtime                          | Tự nối lại, room qua nhiều instance ([ADR-0010](adr/0010-realtime-socketio-redis-adapter.md))                          | SSE, polling                                                                     |
| LLM qua `LLM_PROVIDER`      | Trợ lý CSKH                       | Đổi nhà cung cấp không sửa nghiệp vụ, người xác nhận thao tác ghi ([ADR-0011](adr/0011-ai-agent-human-in-the-loop.md)) | Cho agent ghi trực tiếp                                                          |
| Nginx                       | TLS, proxy, web tĩnh              | Reload không rớt request, đổi upstream bằng file ([ADR-0013](adr/0013-trien-khai-production-blue-green.md))            | ALB, Traefik                                                                     |
| Docker Compose trên một EC2 | Chạy production                   | Rẻ, đủ cho đồ án                                                                                                       | ECS, Kubernetes                                                                  |
| GitHub Actions + OIDC       | CI/CD                             | Không có access key dài hạn ([ADR-0014](adr/0014-oidc-va-cong-ssh-tam-thoi.md))                                        | SSM, self-hosted runner                                                          |
| S3                          | Backup ngoài máy                  | Sống sót khi mất EC2 ([ADR-0016](adr/0016-backup-postgres-len-s3.md))                                                  | EBS snapshot, tải về máy cá nhân                                                 |
| React + Vite + Tailwind     | UI demo                           | Build tĩnh, phục vụ qua Nginx                                                                                          | Next.js                                                                          |
