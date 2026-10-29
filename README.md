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

Seed tạo 5 danh mục, 10 thương hiệu, 200 sản phẩm, 25 tài khoản và 50 đơn hàng ở đủ 6 trạng thái. Chạy lại bao nhiêu lần cũng ra cùng một bộ dữ liệu (xoá sạch rồi tạo lại, id bắt đầu từ 1). Seed từ chối chạy khi `NODE_ENV=production`.

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

# Danh sách sản phẩm: phân trang + lọc theo danh mục, thương hiệu, khoảng giá (VND)
curl "http://localhost:3000/api/products?page=1&limit=5"
curl "http://localhost:3000/api/products?categoryId=1&minPrice=5000000&maxPrice=20000000"

# Lỗi trả về tiếng Việt
curl "http://localhost:3000/api/products?minPrice=9000000&maxPrice=1000"
```

Danh mục: `1` Điện thoại, `2` Laptop, `3` Phụ kiện, `4` Âm thanh, `5` Gia dụng.

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

### 7. Dừng và dọn dẹp

```bash
docker compose down      # dừng, giữ dữ liệu
docker compose down -v   # dừng và xoá volume (mất dữ liệu DB/Redis)
```

### Sự cố thường gặp

| Hiện tượng                                           | Cách xử lý                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `required variable POSTGRES_PASSWORD is missing`     | Chưa tạo `.env` hoặc thiếu biến – xem bước 2                                                                       |
| `port is already allocated`                          | Cổng 3000/5432/6379 đang bận: đặt `API_HOST_PORT`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT` trong `.env`            |
| Api ở trạng thái `unhealthy`/restart liên tục        | `docker compose logs api` – thường do sai biến môi trường (app dừng ngay khi validate thất bại) hoặc migration lỗi |
| Đổi mật khẩu Postgres nhưng không đăng nhập được     | Postgres chỉ đọc mật khẩu ở lần khởi tạo volume đầu tiên: `docker compose down -v` rồi chạy lại                    |
| `This version of pnpm requires at least Node.js v22` | Dùng pnpm 10 (xem bước 1)                                                                                          |
