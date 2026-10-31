# infra

Hạ tầng triển khai của ShopFast.

Môi trường **dev** dùng `docker-compose.yml` ở gốc repo (api + postgres:16 + redis:7) – xem [README → Chạy cục bộ](../README.md#chạy-cục-bộ) và [ADR-0002](../docs/adr/0002-mo-hinh-du-lieu-va-moi-truong-dev.md).

**Production** trên một EC2: [docker-compose.prod.yml](docker-compose.prod.yml), lý do thiết kế ở [ADR-0013](../docs/adr/0013-trien-khai-production-blue-green.md).

| Đường dẫn                                                                      | Vai trò                                                                                                                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [nginx/templates/default.conf.template](nginx/templates/default.conf.template) | HTTP → HTTPS, TLS, web tĩnh                                                                                                                     |
| [nginx/api.conf](nginx/api.conf)                                               | Proxy `/api`, `/health`, `/admin/queues`, `/socket.io`; API chạy `TRUST_PROXY=1` ([ADR-0008](../docs/adr/0008-rate-limit-va-khoa-dang-nhap.md)) |
| [nginx/upstream/](nginx/upstream/)                                             | `blue.conf`, `green.conf`; `active.conf` do script sinh                                                                                         |
| [secrets/ssm-entrypoint.sh](secrets/ssm-entrypoint.sh)                         | Entrypoint API: nạp secret từ SSM                                                                                                               |
| [secrets/secrets-agent.sh](secrets/secrets-agent.sh)                           | Sidecar: mật khẩu Postgres/Redis vào tmpfs                                                                                                      |
| [scripts/switch-upstream.sh](scripts/switch-upstream.sh)                       | Đổi màu blue-green                                                                                                                              |
| [scripts/init-letsencrypt.sh](scripts/init-letsencrypt.sh)                     | Cấp chứng chỉ lần đầu                                                                                                                           |

## Chuẩn bị EC2

1. Cài Docker + Compose plugin + AWS CLI (để đăng nhập ECR). Security group chỉ mở 80, 443.
2. Gắn IAM role với quyền tối thiểu:
   - `ssm:GetParametersByPath`, `ssm:GetParameter` trên `arn:aws:ssm:<region>:<account>:parameter/shopfast/prod/*`
   - Dùng KMS key riêng thì thêm `kms:Decrypt`; khoá mặc định `aws/ssm` không cần
   - Kéo image từ ECR thì thêm `AmazonEC2ContainerRegistryReadOnly`
3. Cho container gọi được IMDS. Thiếu bước này `aws` trong container sẽ lỗi credential:

   ```bash
   aws ec2 modify-instance-metadata-options --instance-id <id> \
     --http-tokens required --http-put-response-hop-limit 2
   ```

4. Tạo tham số SSM (SecureString, giá trị một dòng). Mật khẩu Postgres/Redis chỉ gồm `A-Za-z0-9_-`:

   | Tham số                                     | Ghi chú                                                           |
   | ------------------------------------------- | ----------------------------------------------------------------- |
   | `/shopfast/prod/postgres/POSTGRES_PASSWORD` |                                                                   |
   | `/shopfast/prod/redis/REDIS_PASSWORD`       |                                                                   |
   | `/shopfast/prod/api/DATABASE_URL`           | `postgresql://shopfast:<mk>@postgres:5432/shopfast?schema=public` |
   | `/shopfast/prod/api/REDIS_URL`              | `redis://:<mk>@redis:6379`                                        |
   | `/shopfast/prod/api/JWT_SECRET`             | Tối thiểu 32 ký tự                                                |
   | `/shopfast/prod/api/SMTP_HOST`, `SMTP_*`    | `MAIL_FROM`, `SMTP_USER`, `SMTP_PASSWORD`…                        |
   | `/shopfast/prod/api/LLM_*`                  | Khi bật AI. Mọi biến của `env.validation.ts` đều đặt được ở đây   |

5. Biến không bí mật lấy từ shell (user-data hoặc pipeline), **không** dùng file `.env`:

   ```bash
   export DOMAIN=shop.example.com AWS_REGION=ap-southeast-1 IMAGE_TAG=<tag>
   export API_IMAGE=<account>.dkr.ecr.<region>.amazonaws.com/shopfast-api
   export WEB_IMAGE=<account>.dkr.ecr.<region>.amazonaws.com/shopfast-web
   ```

## Build image

Chạy ở gốc repo. Web nhận cấu hình `VITE_*` qua `--build-arg`; không bao giờ truyền secret.

```bash
docker build -f apps/api/Dockerfile -t "$API_IMAGE:$IMAGE_TAG" .
docker build -f apps/web/Dockerfile -t "$WEB_IMAGE:$IMAGE_TAG" .
```

**Không dùng ECR:** build ngay trên EC2 (cần ít nhất 4 GB RAM hoặc swap), đặt `API_IMAGE=shopfast-api`, `WEB_IMAGE=shopfast-web`, `IMAGE_TAG=current` và bỏ các bước `pull`. Dùng chung một tag nên màu cũ mất image cũ sau khi tạo lại; muốn rollback theo bản thì đặt tag theo commit.

## Lần deploy đầu

```bash
cd infra
export LETSENCRYPT_EMAIL=ops@example.com
docker compose -f docker-compose.prod.yml --profile blue --profile tools pull
./scripts/init-letsencrypt.sh --staging            # thử trước, tránh hạn mức Let's Encrypt
# Staging chạy được thì xoá cert staging (`rm -rf` live/archive/renewal của DOMAIN trong volume
# letsencrypt) và chạy lại không có cờ.
./scripts/init-letsencrypt.sh
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d api-blue
./scripts/switch-upstream.sh blue
```

## Deploy bản mới (ví dụ đang chạy blue)

```bash
export IMAGE_TAG=<tag mới>
alias dc='docker compose -f docker-compose.prod.yml'
dc --profile green --profile tools pull
dc run --rm migrate                  # migration phải tương thích ngược với bản đang chạy
dc up -d --no-deps web               # đổ web mới, không đụng nginx
dc up -d api-green                   # chờ healthy: dc ps api-green
./scripts/switch-upstream.sh green
# Theo dõi vài phút. Có lỗi: ./scripts/switch-upstream.sh blue, rồi dc stop api-green
dc stop api-blue                     # tắt êm theo ADR-0012
```

`IMAGE_TAG` đổi nên chỉ màu được `up` mới dùng tag mới. Rollback khi đã dừng màu cũ: đặt lại tag cũ, `dc up -d api-blue`, rồi đổi màu.

## Vận hành

- **Chạy lệnh cần secret:** dùng `dc run --rm migrate <lệnh>` thay vì `docker exec` (exec không đi qua entrypoint nên không có biến).
- **Đổi secret:** sửa SSM rồi khởi động màu mới; `docker compose restart secrets-agent postgres redis` cho mật khẩu Redis. Đổi mật khẩu Postgres cần `ALTER ROLE` và sửa cả `DATABASE_URL`.
- **Gia hạn cert:** tự động mỗi 12 giờ, Nginx reload trong vòng 5 phút sau khi có cert mới.
- Xử lý sự cố: [ADR-0013](../docs/adr/0013-trien-khai-production-blue-green.md#xử-lý-khi-sự-cố).

Phần sẽ bổ sung: script sao lưu DB, pipeline CI/CD.
