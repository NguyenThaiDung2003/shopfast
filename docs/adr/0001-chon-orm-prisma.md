# ADR-0001: Chọn Prisma làm ORM

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-29

## Bối cảnh

Backend ShopFast dùng NestJS 10 + PostgreSQL 16, TypeScript strict. Các yêu cầu liên quan tới tầng dữ liệu:

- F06: lọc sản phẩm theo danh mục/khoảng giá/thương hiệu có phân trang; đặt đơn **không được bán vượt tồn kho** khi nhiều người mua cùng lúc.
- Dữ liệu ban đầu nạp bằng script seed.
- Pipeline CI/CD phải tự chạy migration khi triển khai; mọi thay đổi đi qua pull request.
- Quy ước kiến trúc: service không gọi ORM trực tiếp mà qua repository.

## Lựa chọn

1. **TypeORM 0.3** – tích hợp chính thức `@nestjs/typeorm`, entity dạng class + decorator.
2. **Prisma 6** – schema khai báo (`schema.prisma`), client sinh mã có kiểu đầy đủ. ✅ **Được chọn**
3. Query builder (Kysely/Knex) – linh hoạt nhưng phải tự quản lý mapping và migration.

## Lý do

- **Type-safety đầu-cuối:** client sinh từ schema nên sai tên cột/kiểu dữ liệu bị phát hiện khi biên dịch, khớp với `strict: true`. Kết quả `select`/`include` được suy kiểu chính xác, giảm lỗi runtime.
- **Một nguồn sự thật cho schema:** `schema.prisma` vừa là mô hình dữ liệu vừa sinh migration SQL (`prisma migrate dev`). File SQL được review trong PR; production chạy `prisma migrate deploy` trong pipeline, không có cơ chế tự đồng bộ schema nguy hiểm.
- **Chống bán vượt tồn kho:** dùng cập nhật có điều kiện, nguyên tử trong một câu SQL:
  ```ts
  const { count } = await tx.product.updateMany({
    where: { id, stock: { gte: qty } },
    data: { stock: { decrement: qty } },
  });
  if (count === 0)
    throw new AppException(HttpStatus.CONFLICT, 'OUT_OF_STOCK', 'Sản phẩm không đủ hàng.');
  ```
  bọc trong `prisma.$transaction` cho nhiều dòng của đơn. PostgreSQL tự khoá dòng khi UPDATE nên hai request đồng thời không thể cùng trừ quá tồn kho. Khi cần khoá đọc trước, dùng `$queryRaw ... FOR UPDATE`.
- **Seed** có sẵn qua `prisma db seed`.
- Repository bọc `PrismaService` nên service chỉ phụ thuộc interface của repository; unit test mock repository, không cần DB.

## Đánh đổi

| Đánh đổi                                            | Giảm thiểu                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Không có module Nest chính thức                     | Tự viết `PrismaService`/`PrismaModule` (≈20 dòng, `src/database/`)                                   |
| Truy vấn phức tạp, khoá dòng, CTE phải viết raw SQL | Dùng `$queryRaw` có tham số hoá (tagged template), không nối chuỗi; gói gọn trong repository         |
| Cần bước `prisma generate` trước build/test         | Script `postinstall` của `apps/api`; pipeline chạy `pnpm install` trước test                         |
| Query engine binary làm image Docker lớn hơn        | Khai báo `binaryTargets` cho `linux-musl-openssl-3.0.x`, multi-stage build chỉ copy engine cần thiết |
| Ít kiểm soát SQL sinh ra so với query builder       | Bật log truy vấn ở môi trường dev, đo p95 với chỉ tiêu < 50 ms (có cache) và < 300 ms (đặt hàng)     |

## Xử lý khi sự cố

- **Migration lỗi khi triển khai:** `prisma migrate deploy` thất bại → bước deploy dừng, health check không đạt, pipeline quay lui image trước. Đánh dấu bằng `prisma migrate resolve --rolled-back <tên>` rồi phát hành migration sửa. Quy tắc: migration phải tương thích ngược (thêm cột trước, xoá sau) để image cũ vẫn chạy được khi rollback.
- **PostgreSQL mất kết nối:** `PrismaService` không `$connect()` lúc khởi động nên API vẫn lên; truy vấn lỗi được filter trả 503/500 bằng thông điệp tiếng Việt, không lộ chi tiết. Health endpoint (F07) báo `database: down` để giám sát phát hiện; các trang đọc có cache Redis (F04) vẫn phục vụ được.
- **Cạn connection pool khi tải cao:** điều chỉnh `connection_limit` trong `DATABASE_URL`; theo dõi qua log lỗi `P2024`.
- **Cần thay ORM:** chỉ tầng repository phụ thuộc Prisma, phạm vi thay đổi giới hạn trong các file `*.repository.ts`.
