# ShopFast

Backend thương mại điện tử cho ~200.000 khách hàng (Defense Case Study 6, Module 6): NestJS 10, PostgreSQL 16, Redis 7, Prisma 6, monorepo pnpm.

```
apps/api   NestJS API
apps/web   React + Vite + Tailwind (UI demo)
infra/     Hạ tầng triển khai
docs/adr/  Architecture Decision Records
```

Production: <https://16-178-17-65.sslip.io> (một EC2, blue-green, HTTPS Let's Encrypt).

## Tài liệu

| Tài liệu                                       | Nội dung                                     |
| ---------------------------------------------- | -------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)   | Sơ đồ tổng thể, luồng dữ liệu, thành phần    |
| [docs/spec-summary.md](docs/spec-summary.md)   | Các chủ đề đã tích hợp và bài toán nghiệp vụ |
| [docs/adr/](docs/adr/)                         | Quyết định kỹ thuật                          |
| [infra/README.md](infra/README.md)             | Triển khai và vận hành production            |
| [infra/aws/README.md](infra/aws/README.md)     | Thiết lập IAM, S3, Security Group            |
| [docs/restore-drill.md](docs/restore-drill.md) | Diễn tập khôi phục backup                    |
| [docs/defense/](docs/defense/)                 | Dàn ý slide, kịch bản demo, câu hỏi bảo vệ   |
| [CLAUDE.md](CLAUDE.md)                         | Quy ước phát triển                           |

## CI/CD

- **CI** ([ci.yml](.github/workflows/ci.yml)) chạy trên PR vào `main`: lint, unit test kèm coverage, e2e với Postgres và Redis thật, build Docker.
- **CD** ([deploy.yml](.github/workflows/deploy.yml)) chạy khi push `main`: chạy lại CI, đẩy image tag theo SHA lên GHCR, dời tag `production`; EC2 tự kéo bản mới và deploy blue-green. Lỗi sau khi đổi traffic thì tự rollback.

## Chạy cục bộ

### 1. Yêu cầu

| Công cụ                     | Phiên bản                                                                   |
| --------------------------- | --------------------------------------------------------------------------- |
| Docker Desktop (Compose v2) | mới nhất                                                                    |
| Node.js                     | 20 LTS (`nvm use` đọc `.nvmrc`) – chỉ cần khi chạy api/test ngoài container |
| pnpm                        | 10.x (`npm i -g pnpm@10`) – pnpm 11 yêu cầu Node ≥ 22 nên không dùng được   |

### 2. Tạo file môi trường

```bash
cp .env.example .env
```

Thay mọi giá trị `change-me` (mật khẩu chỉ gồm chữ và số). Tạo nhanh chuỗi ngẫu nhiên: `openssl rand -hex 32`. Nhớ cập nhật mật khẩu tương ứng trong `DATABASE_URL` và `REDIS_URL`. File `.env` đã bị gitignore.

### 3. Khởi động bằng Docker Compose

```bash
docker compose up -d --build
docker compose ps          # chờ api, postgres, redis ở trạng thái (healthy)
docker compose logs -f api # xem log; lúc khởi động api tự chạy `prisma migrate deploy`
```

| Service  | Địa chỉ trên host         | Ghi chú                                   |
| -------- | ------------------------- | ----------------------------------------- |
| api      | http://localhost:3000/api |                                           |
| postgres | 127.0.0.1:5432            | Chỉ publish cho dev, không lộ ra mạng LAN |
| redis    | 127.0.0.1:6379            | Chỉ publish cho dev, có mật khẩu          |
| mailpit  | http://127.0.0.1:8025     | SMTP giả: xem mọi email do job gửi (dev)  |

### 4. Nạp dữ liệu mẫu

```bash
docker compose exec api npx prisma db seed
```

Seed tạo 5 danh mục, 10 thương hiệu, 200 sản phẩm, 25 tài khoản và 50 đơn hàng ở đủ 6 trạng thái. Chạy lại bao nhiêu lần cũng ra cùng một bộ dữ liệu (xoá sạch rồi tạo lại, id bắt đầu từ 1). Seed từ chối chạy khi `NODE_ENV=production`. Cuối seed tự xoá cache catalog (`cache:*` trong Redis) vì dữ liệu cũ không còn đúng.

Tài khoản mẫu (mật khẩu chung = `SEED_USER_PASSWORD` trong `.env`):

| Vai trò   | Email                                                      |
| --------- | ---------------------------------------------------------- |
| Admin     | `admin01@shopfast.local`                                   |
| Support   | `support01@shopfast.local`, `support02@shopfast.local`     |
| Warehouse | `warehouse01@shopfast.local`, `warehouse02@shopfast.local` |
| Customer  | `customer01@shopfast.local` … `customer20@shopfast.local`  |

### 5. Gọi thử API

```bash
curl http://localhost:3000/health        # readiness: DB + Redis (200 ok | 200 degraded | 503)
curl http://localhost:3000/health/live   # liveness: chỉ kiểm tiến trình

# Danh sách sản phẩm: phân trang + lọc theo danh mục, thương hiệu, khoảng giá (VND) + sắp xếp
curl "http://localhost:3000/api/products?page=1&limit=5"
curl "http://localhost:3000/api/products?categoryId=1&minPrice=5000000&maxPrice=20000000&sort=price_asc"

# Danh mục / thương hiệu kèm số sản phẩm (bộ lọc), sắp theo tên tiếng Việt
curl http://localhost:3000/api/categories
curl http://localhost:3000/api/brands

# Chi tiết sản phẩm
curl http://localhost:3000/api/products/1

# Lỗi trả về tiếng Việt
curl "http://localhost:3000/api/products?minPrice=9000000&maxPrice=1000"
```

Danh mục: `1` Điện thoại, `2` Laptop, `3` Phụ kiện, `4` Âm thanh, `5` Gia dụng.

#### Catalog

| Method | Endpoint                  | Quyền            | Mô tả                                                                                                                                                                                                                                               |
| ------ | ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/products`           | công khai        | `page` (1–1000), `limit` (1–100, mặc định 20), `categoryId`, `brandId`, `minPrice`, `maxPrice`, `sort` = `newest` (mặc định) \| `price_asc` \| `price_desc` \| `name_asc`                                                                           |
| GET    | `/api/products/inventory` | WAREHOUSE, ADMIN | Tồn kho đọc thẳng DB: `q`, `categoryId`, `stockLevel`, `sort`, `summary`                                                                                                                                                                            |
| GET    | `/api/products/:id`       | công khai        | Chi tiết sản phẩm                                                                                                                                                                                                                                   |
| PATCH  | `/api/products/:id`       | ADMIN, WAREHOUSE | Body: `price`, `compareAtPrice`, `imageUrl` (chỉ ADMIN; `null` để xoá hai trường sau), `stock` (đặt số lượng, kiểm kê; kèm `expectedStock` để lệch → 409 `STOCK_CHANGED`) **hoặc** `stockDelta` (+ nhập / − xuất kho). Phát event `product.updated` |

```bash
# Warehouse nhập thêm 20 sản phẩm (TOKEN lấy như phần Xác thực, đăng nhập warehouse01)
curl -X PATCH http://localhost:3000/api/products/1 -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"stockDelta":20}'
```

#### Cache catalog

`GET /api/products` và `GET /api/products/:id` được cache trong Redis theo kiểu cache-aside ([ADR-0007](docs/adr/0007-cache-catalog-redis.md)). Đổi giá/tồn kho (PATCH, đặt đơn, huỷ đơn) làm mất hiệu lực ngay, nên khách không thấy giá cũ. Redis lỗi thì API tự đọc DB và vẫn trả 200.

| Method | Endpoint                 | Quyền | Mô tả                                                                         |
| ------ | ------------------------ | ----- | ----------------------------------------------------------------------------- |
| GET    | `/api/admin/cache/stats` | ADMIN | Số lần trúng/trượt và `hitRate` theo nhóm (`product`, `product_list`) và tổng |
| DELETE | `/api/admin/cache/stats` | ADMIN | Đặt lại bộ đếm (204)                                                          |

Cấu hình (đều có mặc định): `CACHE_ENABLED`, `CACHE_PRODUCT_TTL_SECONDS` (300), `CACHE_LIST_TTL_SECONDS` (60), `CACHE_NEGATIVE_TTL_SECONDS` (30), `REDIS_COMMAND_TIMEOUT_MS` (100).

Đo thời gian phản hồi (cần stack Docker đang chạy và đã seed). Kết quả được ghi vào [docs/perf/cache-benchmark.md](docs/perf/cache-benchmark.md):

```bash
pnpm --filter @shopfast/api bench:cache
# Cột đối chứng khi tắt cache:
CACHE_ENABLED=false docker compose up -d api && pnpm --filter @shopfast/api bench:cache
docker compose up -d api   # bật lại
```

#### Giỏ hàng & đơn hàng

Cơ chế chống bán vượt và chống tạo trùng đơn: [ADR-0005](docs/adr/0005-khoa-ton-kho-khi-dat-hang.md).

| Method | Endpoint                                  | Quyền                              | Mô tả                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/cart`                               | CUSTOMER                           | Giỏ hàng, tạm tính, cờ `insufficientStock` từng dòng                                                                                                                                                                                             |
| POST   | `/api/cart/items`                         | CUSTOMER                           | `{ productId, quantity }` – cộng dồn, tối đa 99/sản phẩm                                                                                                                                                                                         |
| PATCH  | `/api/cart/items/:productId`              | CUSTOMER                           | `{ quantity }` – đặt lại số lượng                                                                                                                                                                                                                |
| DELETE | `/api/cart/items/:productId`, `/api/cart` | CUSTOMER                           | Xoá một dòng / xoá hết                                                                                                                                                                                                                           |
| POST   | `/api/orders`                             | CUSTOMER                           | Tạo đơn từ giỏ (201). Body tuỳ chọn `{ shipping: { recipientName, phone, address, note? } }`. Header `Idempotency-Key` tuỳ chọn: gửi lại cùng key → 200 + `Idempotent-Replayed: true`, cùng đơn. Thiếu hàng → 409 `OUT_OF_STOCK` nêu rõ sản phẩm |
| GET    | `/api/orders/me`                          | CUSTOMER                           | Lịch sử đơn của mình, mới nhất trước (`page`, `limit` ≤ 50, `status=PAID,PROCESSING`, `q` = mã đơn/tên sản phẩm); kèm `statusCounts`                                                                                                             |
| GET    | `/api/orders`                             | WAREHOUSE, ADMIN                   | Danh sách đơn cho kho: lọc `status`, tìm `q`, `statusCounts`, `customer`, `nextStatuses`                                                                                                                                                         |
| GET    | `/api/orders/:id`                         | chủ đơn, SUPPORT, WAREHOUSE, ADMIN | Chi tiết đơn + `statusHistory` (chủ đơn không thấy tên nhân viên)                                                                                                                                                                                |
| PATCH  | `/api/orders/:id/status`                  | WAREHOUSE, ADMIN                   | `{ status, note? }` theo state machine ([ADR-0006](docs/adr/0006-state-machine-don-hang.md)); sai bước → 409. Huỷ thì hoàn kho                                                                                                                   |

```bash
# Customer (TOKEN của customer01): thêm vào giỏ rồi đặt hàng, an toàn khi bấm hai lần
curl -X POST http://localhost:3000/api/cart/items -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"productId":2,"quantity":1}'
KEY=$(node -e 'console.log(crypto.randomUUID())')
curl -i -X POST http://localhost:3000/api/orders -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY"
curl -i -X POST http://localhost:3000/api/orders -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY"  # 200, cùng đơn
```

#### Tài liệu API (Swagger)

Mở **http://localhost:3000/docs** (JSON: `/docs-json`). Đăng nhập qua `POST /api/auth/login`, bấm **Authorize** và dán `accessToken` để gọi các endpoint có biểu tượng khoá. Tắt bằng `SWAGGER_ENABLED=false`.

```bash
# Warehouse chuyển trạng thái đơn (TOKEN của warehouse01, ORDER_ID lấy từ /api/orders/me của khách)
curl -X PATCH http://localhost:3000/api/orders/$ORDER_ID/status -H "Authorization: Bearer $TOKEN"   -H "Content-Type: application/json" -d '{"status":"PAID","note":"Đã nhận chuyển khoản"}'
```

#### Xác thực

Mọi endpoint yêu cầu `Authorization: Bearer <accessToken>` trừ các endpoint công khai (health, products, các endpoint đăng ký/đăng nhập/refresh/logout/OTP). Thiết kế: [ADR-0003](docs/adr/0003-quan-ly-refresh-token.md).

| Method | Endpoint               | Quyền        | Mô tả                                                     |
| ------ | ---------------------- | ------------ | --------------------------------------------------------- |
| POST   | `/api/auth/register`   | công khai    | Đăng ký (luôn là CUSTOMER)                                |
| POST   | `/api/auth/login`      | công khai    | Trả `accessToken` (15 phút) + `refreshToken` (7 ngày)     |
| POST   | `/api/auth/refresh`    | công khai    | Đổi refresh token lấy cặp token mới (token cũ bị thu hồi) |
| POST   | `/api/auth/logout`     | công khai    | Thu hồi phiên của refresh token gửi lên                   |
| POST   | `/api/auth/logout-all` | đã đăng nhập | Thu hồi mọi phiên của user                                |
| GET    | `/api/auth/me`         | đã đăng nhập | Thông tin user hiện tại                                   |
| POST   | `/api/auth/otp/send`   | công khai    | Gửi OTP giả lập (mã in ra log api ở dev)                  |
| POST   | `/api/auth/otp/verify` | công khai    | Xác thực OTP                                              |
| GET    | `/api/users`           | ADMIN        | Danh sách user                                            |

```bash
# Đăng nhập bằng tài khoản seed (mật khẩu = SEED_USER_PASSWORD trong .env)
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin01@shopfast.local","password":"<SEED_USER_PASSWORD>"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/users   # admin: 200, customer: 403

# OTP: gửi rồi xem mã trong log api
curl -X POST http://localhost:3000/api/auth/otp/send -H "Content-Type: application/json" \
  -d '{"email":"customer01@shopfast.local","purpose":"VERIFY_EMAIL"}'
docker compose logs api | grep "GIẢ LẬP"
```

#### Rate limit & khoá đăng nhập

Bộ đếm nằm trong Redis nên đúng khi chạy nhiều instance ([ADR-0008](docs/adr/0008-rate-limit-va-khoa-dang-nhap.md)). Đếm theo user khi đã đăng nhập, theo IP khi chưa (IP thật lấy qua `X-Forwarded-For`, cần `TRUST_PROXY=1` khi đứng sau Nginx – xem [infra/nginx/api.conf](infra/nginx/api.conf)).

| Hạn mức (mặc định) | Áp cho                    | Biến môi trường          |
| ------------------ | ------------------------- | ------------------------ |
| 300 request / 60 s | toàn API, gộp mọi route   | `RATE_LIMIT_GLOBAL`      |
| 10 request / 60 s  | `POST /api/auth/login`    | `RATE_LIMIT_LOGIN`       |
| 3 request / 5 phút | `POST /api/auth/otp/send` | `RATE_LIMIT_OTP_SEND`    |
| 5 request / 60 s   | `POST /api/orders`        | `RATE_LIMIT_PROMO_ORDER` |

Vượt hạn mức → `429 TOO_MANY_REQUESTS`, header `Retry-After` và `details.retryAfterSeconds`. Ngoài ra, sai mật khẩu 5 lần liên tiếp cho **cùng một email** (từ bất kỳ IP nào) → `429 LOGIN_LOCKED`, khoá 1 phút; các lần khoá sau 5 phút rồi 30 phút; đăng nhập đúng thì reset. Redis lỗi thì cả hai cơ chế tạm cho qua và log cảnh báo.

```bash
# Mở khoá tay một email (dev)
EMAIL_HASH=$(printf '%s' 'customer01@shopfast.local' | sha256sum | cut -d' ' -f1)
docker compose exec redis redis-cli DEL \
  auth:login:fail:$EMAIL_HASH auth:login:strikes:$EMAIL_HASH auth:login:lock:$EMAIL_HASH
```

#### Background jobs (email, hoá đơn, đồng bộ tồn kho)

Đặt đơn và đổi trạng thái đơn đẩy job vào BullMQ; API trả về ngay, worker xử lý sau ([ADR-0009](docs/adr/0009-background-jobs-bullmq.md)).

| Khi                   | Queue / job                                   | Ghi chú                                                       |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Đặt đơn               | `email` / `order-confirmation`                | Email xác nhận (Mailpit ở dev)                                |
| Đặt đơn               | `inventory-sync` / `inventory-reserve`        | Gọi API đối tác giả lập, lỗi ngẫu nhiên 30% để demo retry     |
| Đặt đơn + 30 phút     | `email` / `payment-reminder` (delayed)        | Chỉ gửi nếu đơn vẫn `PENDING_PAYMENT`                         |
| Đơn → `PAID`          | `invoice` / `invoice`                         | PDF `<mã đơn>.pdf` trong volume `invoices` (`/data/invoices`) |
| Đơn → `CANCELLED`     | `inventory-sync` / `inventory-release`        | Trả hàng cho đối tác                                          |
| 0h hằng ngày (giờ VN) | `email` / `daily-revenue-report` (repeatable) | Doanh thu hôm qua gửi cho mọi ADMIN                           |

Job lỗi tự thử lại (backoff exponential); hết lượt thử thì chuyển sang queue `dead-letter` kèm lý do. Chạy lại job không gửi email lần hai (bảng `email_deliveries`).

| Method | Endpoint                    | Quyền | Mô tả                                                                  |
| ------ | --------------------------- | ----- | ---------------------------------------------------------------------- |
| GET    | `/api/admin/queues/stats`   | ADMIN | Số job đang chờ / đang chạy / hẹn giờ / hoàn tất / thất bại từng queue |
| GET    | `/api/admin/system/version` | ADMIN | Phiên bản, commit (`APP_VERSION`, `GIT_COMMIT`), môi trường            |
| POST   | `/api/admin/queues/session` | ADMIN | Đặt cookie phiên để mở Bull Board trên trình duyệt (204)               |
| GET    | `/admin/queues`             | ADMIN | Bull Board (ngoài `/api`)                                              |

Mở Bull Board: đăng nhập admin trên Swagger (`/docs` → Authorize), gọi `POST /api/admin/queues/session`, rồi mở http://localhost:3000/admin/queues trên cùng trình duyệt. Demo dead-letter: `PARTNER_FAILURE_RATE=1 docker compose up -d api` rồi đặt một đơn.

#### Theo dõi đơn realtime (WebSocket)

Socket.IO tại `/socket.io` (ngoài `/api`, chỉ transport websocket), xác thực bằng access token ngay khi kết nối ([ADR-0010](docs/adr/0010-realtime-socketio-redis-adapter.md)).

| Sự kiện             | Chiều           | Dữ liệu                                   | Ghi chú                                                                     |
| ------------------- | --------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `order:subscribe`   | client → server | `{ orderId }`                             | Ack `{ ok: true, order: { id, code, status } }` hoặc `{ ok: false, error }` |
| `order:unsubscribe` | client → server | `{ orderId }`                             | Ack `{ ok: true }`                                                          |
| `order:updated`     | server → client | `{ orderId, code, from, to, occurredAt }` | Chỉ gửi tới client đã subscribe đơn đó                                      |

Chỉ chủ đơn hoặc nhân viên (SUPPORT, WAREHOUSE, ADMIN) subscribe được; đơn của người khác trả `ORDER_NOT_FOUND`. Token sai/hết hạn → `connect_error` với `err.data = { code, message }`.

Dùng trong `apps/web` (tự nối lại và tự subscribe lại sau khi mất mạng; Vite đã proxy `/socket.io`):

```tsx
import { useOrderTracking } from './realtime/useOrderTracking';

const { statuses, connection, connectionError } = useOrderTracking([orderId], {
  getAccessToken: () => auth.accessToken, // gọi lại ở mỗi lần nối lại → trả token đã refresh
});
// statuses[orderId] === 'PAID' …; connection: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
```

Thử nhanh bằng Node (`TOKEN` của customer01, `ORDER_ID` từ `/api/orders/me`), rồi đổi trạng thái đơn bằng tài khoản kho:

```bash
cd apps/api && node -e "
const s = require('socket.io-client').io('http://localhost:3000', { transports: ['websocket'], auth: { token: process.env.TOKEN } });
s.on('connect', async () => console.log(await s.emitWithAck('order:subscribe', { orderId: process.env.ORDER_ID })));
s.on('order:updated', (u) => console.log('order:updated', u));
s.on('connect_error', (e) => console.log(e.data));"
```

Chạy nhiều instance (blue-green): mọi instance trỏ cùng `REDIS_URL`; emit ở instance này tới được client nối vào instance khác. Nginx cần `location /socket.io/` có header `Upgrade` (`infra/nginx/api.conf`).

#### Ticket hỗ trợ và trợ lý AI

Khách tạo ticket và nhắn tin; nhân viên hỗ trợ trả lời. Ticket mới được LLM phân loại ở nền (queue `ticket-classify`) vào `DON_HANG`, `VAN_CHUYEN`, `THANH_TOAN`, `DOI_TRA`, `SAN_PHAM` hoặc `KHAC`. Nhân viên hỏi trợ lý AI; trợ lý tra đơn/tồn kho bằng tool, còn huỷ đơn hay đổi trả thì **chỉ tạo đề xuất chờ người xác nhận** ([ADR-0011](docs/adr/0011-ai-agent-human-in-the-loop.md)).

| Method | Endpoint                                   | Quyền                      | Mô tả                                                               |
| ------ | ------------------------------------------ | -------------------------- | ------------------------------------------------------------------- |
| POST   | `/api/support/tickets`                     | CUSTOMER                   | Tạo ticket (`subject`, `message`, `orderId?`), có `Idempotency-Key` |
| GET    | `/api/support/tickets/me`                  | CUSTOMER                   | Ticket của tôi; lọc `status=OPEN,ANSWERED`, tìm `q`, `statusCounts` |
| GET    | `/api/support/tickets`                     | SUPPORT, ADMIN             | Hàng chờ, lọc `status`, `category`, tìm `q`, `statusCounts`         |
| GET    | `/api/support/tickets/:id`                 | chủ ticket, SUPPORT, ADMIN | Chi tiết + tin nhắn                                                 |
| POST   | `/api/support/tickets/:id/messages`        | chủ ticket, SUPPORT, ADMIN | Nhắn tin (khách → `OPEN`, nhân viên → `ANSWERED`)                   |
| PATCH  | `/api/support/tickets/:id`                 | SUPPORT, ADMIN             | Đóng/mở lại, sửa nhóm bằng tay                                      |
| POST   | `/api/support/tickets/:id/assistant`       | SUPPORT, ADMIN             | Hỏi trợ lý AI (`question`)                                          |
| GET    | `/api/support/pending-actions`             | SUPPORT, ADMIN             | Đề xuất của trợ lý, lọc `status`, `ticketId`                        |
| POST   | `/api/support/pending-actions/:id/confirm` | SUPPORT, ADMIN             | Xác nhận → **lúc này mới** huỷ đơn / tạo yêu cầu đổi trả            |
| POST   | `/api/support/pending-actions/:id/reject`  | SUPPORT, ADMIN             | Từ chối, không thực thi gì                                          |

Bật LLM trong `.env` (mặc định `LLM_PROVIDER=disabled`: ticket vẫn dùng được, nhóm = `KHAC`, trợ lý trả 503):

```bash
LLM_PROVIDER=anthropic        # hoặc openai / google (Gemini – AI Studio); hai loại này bắt buộc LLM_MODEL
LLM_API_KEY=<khoá của bạn>    # không commit
# LLM_MODEL=claude-opus-5-5   # mặc định của anthropic
```

Luồng thử trên Swagger (`/docs`): đăng nhập `support01@shopfast.local`, mở ticket mẫu "Muốn huỷ đơn vừa đặt" (seed), gọi `/assistant` với "Khách muốn huỷ đơn, xử lý giúp" → response có `pendingActions[0]` trạng thái `PENDING`, đơn **chưa** đổi → gọi `/pending-actions/{id}/confirm` → đơn `CANCELLED`, đã hoàn kho. Kiểm nhanh cả luồng với LLM thật: `pnpm --filter @shopfast/api smoke:llm`.

Response của `/assistant` có `outcome`: `answered`, `out_of_scope` (câu hỏi ngoài ShopFast bị từ chối), `limit_reached` (hết `AGENT_MAX_TOOL_ROUNDS`), `ungrounded` (câu trả lời nêu thông tin đơn/tồn kho chưa tra bằng tool nên bị chặn). LLM lỗi hoặc quá `AGENT_TIMEOUT_MS` → 503 `AI_UNAVAILABLE`.

#### Health check và tắt êm

`GET /health` và `GET /health/live` nằm ngoài `/api` ([ADR-0012](docs/adr/0012-health-check-va-graceful-shutdown.md)). `/api/health` cũ chuyển hướng 308 sang `/health`.

| Tình huống                       | `GET /health`                | `GET /health/live` |
| -------------------------------- | ---------------------------- | ------------------ |
| DB + Redis ổn                    | 200 `ok`                     | 200                |
| Redis lỗi                        | 200 `degraded` (vẫn phục vụ) | 200                |
| DB lỗi                           | 503                          | 200                |
| Đang tắt (`docker compose stop`) | 503 `shutting_down`          | 200                |

Khi nhận SIGTERM, API:

1. Trả 503 ở `/health` trong `SHUTDOWN_DRAIN_MS` (5s) để load balancer rút traffic; request vẫn được phục vụ trong lúc đó.
2. Đóng worker BullMQ, chờ job đang chạy xong.
3. Đóng HTTP server (chờ request đang chạy) rồi mới đóng DB và Redis.
4. Quá `SHUTDOWN_TIMEOUT_MS` (25s) thì tự thoát.

Thử: đặt một đơn rồi `docker compose stop api` ngay, xem `docker compose logs api` (có `Shutdown: draining…` và `workers closed`). Exit code `143` là bình thường (Node tự kết thúc bằng SIGTERM sau khi dọn xong); `137` mới là bị SIGKILL.

### 6. Chạy api trực tiếp trên máy (hot reload)

Giữ postgres/redis trong Docker, dừng container api rồi chạy api bằng Node trên host. `.env` ở gốc đã trỏ `localhost`:

```bash
docker compose stop api
pnpm install
pnpm --filter @shopfast/api prisma:deploy   # áp migration
pnpm --filter @shopfast/api db:seed         # nạp dữ liệu mẫu
pnpm --filter @shopfast/api start:dev
pnpm --filter @shopfast/web dev             # UI demo tại http://localhost:5173
```

**Giao diện web (`apps/web`)**: React 18 + Vite + Tailwind + React Router + TanStack Query. Dev server proxy `/api`, `/health`, `/docs`, `/socket.io` sang `localhost:3000`, nên chạy được cả khi api nằm trong Docker. Gốc API đặt bằng `VITE_API_BASE_URL` (mặc định `/api`, xem `apps/web/.env.example`). Đăng nhập bằng tài khoản seed (`customer01@shopfast.local`, `warehouse01@…`, `support01@…`, `admin01@…`, mật khẩu `SEED_USER_PASSWORD`): khách vào giao diện cửa hàng, nhân viên vào `/quan-tri`. Thiết kế gốc (Google Stitch) ở `apps/web/design/`.

Lệnh kiểm tra chất lượng: `pnpm lint`, `pnpm test`, `pnpm test:cov`, `pnpm test:e2e`.

`pnpm test:e2e` chạy với Postgres và Redis thật nên cần `docker compose up -d postgres redis` và hai biến `TEST_DATABASE_URL` (DB tên `*_test`, tự tạo) và `TEST_REDIS_URL` (Redis DB số khác, ví dụ `/1`) trong `.env`. **DB test bị xoá sạch dữ liệu mỗi lần chạy**; test từ chối chạy nếu URL test trùng URL dev. Unit test (`pnpm test`) không cần DB.

### 7. Dừng và dọn dẹp

```bash
docker compose down      # dừng, giữ dữ liệu
docker compose down -v   # dừng và xoá volume (mất dữ liệu DB/Redis)
```

### Sự cố thường gặp

| Hiện tượng                                                                               | Cách xử lý                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `required variable POSTGRES_PASSWORD is missing`                                         | Chưa tạo `.env` hoặc thiếu biến – xem bước 2                                                                       |
| `port is already allocated`                                                              | Cổng 3000/5432/6379 đang bận: đặt `API_HOST_PORT`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT` trong `.env`            |
| Api ở trạng thái `unhealthy`/restart liên tục                                            | `docker compose logs api` – thường do sai biến môi trường (app dừng ngay khi validate thất bại) hoặc migration lỗi |
| Đổi mật khẩu Postgres nhưng không đăng nhập được                                         | Postgres chỉ đọc mật khẩu ở lần khởi tạo volume đầu tiên: `docker compose down -v` rồi chạy lại                    |
| `This version of pnpm requires at least Node.js v22`                                     | Dùng pnpm 10 (xem bước 1)                                                                                          |
| Chạy api/test từ host trên Windows, request đồng thời chậm ~2 giây hoặc lỗi `ORDER_BUSY` | URL trong `.env` đang dùng `localhost` (phân giải ra `::1` trước, Docker chỉ bind IPv4) – đổi thành `127.0.0.1`    |
