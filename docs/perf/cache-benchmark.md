# Đo hiệu năng cache catalog (F04)

Mục tiêu: từ **lần gọi thứ 2** trở đi, `GET /api/products/:id` và `GET /api/products` (có lọc) phản hồi **< 20 ms** ([ADR-0007](../adr/0007-cache-catalog-redis.md)).

## Cách đo

Script [`apps/api/scripts/bench-cache.ts`](../../apps/api/scripts/bench-cache.ts):

```bash
docker compose up -d --build && docker compose exec api npx prisma db seed
pnpm --filter @shopfast/api bench:cache
```

Với từng endpoint (`/api/products/1` và `/api/products?categoryId=1&minPrice=1000000&sort=price_asc&limit=20`), script làm các bước sau:

1. Xoá cache (`cache:*`) và đặt lại bộ đếm, để lần 1 chắc chắn trượt cache.
2. **Lần 1** (đọc DB) và **lần 2** (trúng cache): mỗi lần một request, đo thời gian từ client (`performance.now()`, gồm cả HTTP).
3. 50 request tuần tự để có trung vị và p95 ổn định, không phụ thuộc may rủi của một lần đo.
4. [autocannon](https://github.com/mcollina/autocannon) chạy 10 kết nối trong 10 giây để đo latency dưới tải.
5. Đọc tỉ lệ trúng cache từ `GET /api/admin/cache/stats`.

Tuỳ chọn qua biến môi trường: `BENCH_URL`, `BENCH_DURATION`, `BENCH_CONNECTIONS`, `BENCH_PRODUCT_ID`, `BENCH_ADMIN_EMAIL`, `BENCH_ADMIN_PASSWORD` (mặc định dùng `SEED_USER_PASSWORD`). Script thoát với mã 1 nếu cache bật mà lần 2 ≥ 20 ms.

Môi trường đo hiện tại là máy dev Windows chạy Docker Desktop: API, Postgres và Redis đều trong container, client gọi qua cổng `127.0.0.1:3000`. Số liệu chỉ dùng để so sánh tương đối, không đại diện cho production.

Mục **cache tắt** là đối chứng: chạy API với `CACHE_ENABLED=false` để thấy chi phí khi đọc thẳng DB.

## Kết quả – cache bật

<!-- bench:on:start -->

Chạy lúc 2026-10-29T17:02:59.874Z · Node v20.20.2 · win32 10.0.19045 · 4 CPU · API http://127.0.0.1:3000

| Endpoint          | Lần 1 (miss) |   **Lần 2** | Trung vị 50 lần | p95 50 lần | Đạt < 20ms |
| ----------------- | -----------: | ----------: | --------------: | ---------: | :--------: |
| Chi tiết sản phẩm |      21.7 ms | **12.1 ms** |          5.9 ms |    13.8 ms |     ✅     |
| Danh sách có lọc  |      35.3 ms |  **6.6 ms** |          4.8 ms |     9.8 ms |     ✅     |

Tải autocannon: 10 kết nối × 10 giây.

| Endpoint          | req/s |   p50 |   p90 | p97.5 |   p99 |   max | lỗi / non-2xx |
| ----------------- | ----: | ----: | ----: | ----: | ----: | ----: | ------------: |
| Chi tiết sản phẩm |   585 | 15 ms | 24 ms | 31 ms | 34 ms | 45 ms |         0 / 0 |
| Danh sách có lọc  |   454 | 19 ms | 30 ms | 41 ms | 48 ms | 76 ms |         0 / 0 |

Tỉ lệ trúng cache sau lượt đo (`GET /api/admin/cache/stats`): product 99.98% · product_list 99.98% · tổng 99.98%
<!-- bench:on:end -->

## Kết quả – cache tắt (đối chứng)

<!-- bench:off:start -->

Chạy lúc 2026-10-29T17:04:04.454Z · Node v20.20.2 · win32 10.0.19045 · 4 CPU · API http://127.0.0.1:3000

| Endpoint          | Lần 1 (miss) |   **Lần 2** | Trung vị 50 lần | p95 50 lần | Đạt < 20ms |
| ----------------- | -----------: | ----------: | --------------: | ---------: | :--------: |
| Chi tiết sản phẩm |      19.6 ms | **11.3 ms** |          6.4 ms |    10.1 ms |     ✅     |
| Danh sách có lọc  |      40.6 ms | **12.4 ms** |          9.9 ms |    13.9 ms |     ✅     |

Tải autocannon: 10 kết nối × 10 giây.

| Endpoint          | req/s |   p50 |   p90 |  p97.5 |    p99 |    max | lỗi / non-2xx |
| ----------------- | ----: | ----: | ----: | -----: | -----: | -----: | ------------: |
| Chi tiết sản phẩm |   288 | 32 ms | 46 ms |  57 ms |  64 ms | 125 ms |         0 / 0 |
| Danh sách có lọc  |   152 | 63 ms | 85 ms | 103 ms | 119 ms | 142 ms |         0 / 0 |

Tỉ lệ trúng cache sau lượt đo (`GET /api/admin/cache/stats`): tổng 0.00%
<!-- bench:off:end -->
