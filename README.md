# ShopFast

Backend thương mại điện tử cho ~200.000 khách hàng (Defense Case Study 6, Module 6): NestJS 10, PostgreSQL 16, Redis 7, Prisma 6, monorepo pnpm.

```
apps/api   NestJS API
apps/web   React + Vite + Tailwind (UI demo)
infra/     Hạ tầng triển khai
docs/adr/  Architecture Decision Records
```

Quy ước phát triển: xem [CLAUDE.md](CLAUDE.md). Các quyết định kỹ thuật: [docs/adr/](docs/adr/).

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
docker compose ps          # chờ cả 3 service ở trạng thái (healthy)
docker compose logs -f api # xem log; lúc khởi động api tự chạy `prisma migrate deploy`
```

| Service  | Địa chỉ trên host         | Ghi chú                                   |
| -------- | ------------------------- | ----------------------------------------- |
| api      | http://localhost:3000/api |                                           |
| postgres | 127.0.0.1:5432            | Chỉ publish cho dev, không lộ ra mạng LAN |
| redis    | 127.0.0.1:6379            | Chỉ publish cho dev, có mật khẩu          |

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
curl http://localhost:3000/api/health

# Danh sách sản phẩm: phân trang + lọc theo danh mục, thương hiệu, khoảng giá (VND) + sắp xếp
curl "http://localhost:3000/api/products?page=1&limit=5"
curl "http://localhost:3000/api/products?categoryId=1&minPrice=5000000&maxPrice=20000000&sort=price_asc"

# Chi tiết sản phẩm
curl http://localhost:3000/api/products/1

# Lỗi trả về tiếng Việt
curl "http://localhost:3000/api/products?minPrice=9000000&maxPrice=1000"
```

Danh mục: `1` Điện thoại, `2` Laptop, `3` Phụ kiện, `4` Âm thanh, `5` Gia dụng.

#### Catalog

| Method | Endpoint            | Quyền            | Mô tả                                                                                                                                                                     |
| ------ | ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/products`     | công khai        | `page` (1–1000), `limit` (1–100, mặc định 20), `categoryId`, `brandId`, `minPrice`, `maxPrice`, `sort` = `newest` (mặc định) \| `price_asc` \| `price_desc` \| `name_asc` |
| GET    | `/api/products/:id` | công khai        | Chi tiết sản phẩm                                                                                                                                                         |
| PATCH  | `/api/products/:id` | ADMIN, WAREHOUSE | Body: `price` (chỉ ADMIN), `stock` (đặt số lượng, kiểm kê) **hoặc** `stockDelta` (+ nhập / − xuất kho). Phát event `product.updated`                                      |

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

| Method | Endpoint                                  | Quyền                              | Mô tả                                                                                                                                                                    |
| ------ | ----------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/cart`                               | CUSTOMER                           | Giỏ hàng, tạm tính, cờ `insufficientStock` từng dòng                                                                                                                     |
| POST   | `/api/cart/items`                         | CUSTOMER                           | `{ productId, quantity }` – cộng dồn, tối đa 99/sản phẩm                                                                                                                 |
| PATCH  | `/api/cart/items/:productId`              | CUSTOMER                           | `{ quantity }` – đặt lại số lượng                                                                                                                                        |
| DELETE | `/api/cart/items/:productId`, `/api/cart` | CUSTOMER                           | Xoá một dòng / xoá hết                                                                                                                                                   |
| POST   | `/api/orders`                             | CUSTOMER                           | Tạo đơn từ giỏ (201). Header `Idempotency-Key` tuỳ chọn: gửi lại cùng key → 200 + `Idempotent-Replayed: true`, cùng đơn. Thiếu hàng → 409 `OUT_OF_STOCK` nêu rõ sản phẩm |
| GET    | `/api/orders/me`                          | CUSTOMER                           | Lịch sử đơn của mình, mới nhất trước (`page`, `limit` ≤ 50)                                                                                                              |
| GET    | `/api/orders/:id`                         | chủ đơn, SUPPORT, WAREHOUSE, ADMIN | Chi tiết đơn + `statusHistory` (chủ đơn không thấy tên nhân viên)                                                                                                        |
| PATCH  | `/api/orders/:id/status`                  | WAREHOUSE, ADMIN                   | `{ status, note? }` theo state machine ([ADR-0006](docs/adr/0006-state-machine-don-hang.md)); sai bước → 409. Huỷ thì hoàn kho                                           |

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
