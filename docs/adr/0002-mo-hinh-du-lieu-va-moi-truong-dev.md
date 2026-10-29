# ADR-0002: Mô hình dữ liệu nền và môi trường dev bằng Docker Compose

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-29

## Bối cảnh

F06 cần danh mục sản phẩm có bộ lọc, đặt đơn không bán vượt tồn kho, lịch sử đơn theo khách và phân quyền theo vai trò. F02 yêu cầu khách chỉ theo dõi được đơn của mình. Nhóm cần một môi trường dev giống production (container, mạng nội bộ) và dữ liệu mẫu ổn định để demo và viết test.

## Lựa chọn

| Vấn đề            | Phương án chọn                                                                               | Phương án loại                              |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Kiểu dữ liệu tiền | `INTEGER` theo đồng (VND)                                                                    | `DECIMAL`, `FLOAT`                          |
| Khoá chính        | `UUID` cho `users`, `orders`; `SERIAL` cho `categories`, `brands`, `products`, `order_items` | UUID cho mọi bảng, hoặc SERIAL cho mọi bảng |
| Chống tồn kho âm  | `CHECK (stock >= 0)` ở DB + cập nhật có điều kiện ở repository                               | Chỉ kiểm tra trong code                     |
| Giá trong đơn     | Lưu `unit_price` tại thời điểm đặt ở `order_items`                                           | Join sang giá hiện tại của `products`       |
| Vai trò           | Enum `Role` trên `users` (CUSTOMER, SUPPORT, WAREHOUSE, ADMIN)                               | Bảng role/permission riêng                  |
| Dữ liệu mẫu       | Script seed tự viết, PRNG có seed cố định, `TRUNCATE … RESTART IDENTITY`                     | faker ngẫu nhiên mỗi lần chạy               |
| Môi trường dev    | Docker Compose: api + postgres + redis trên mạng `backend`; cổng DB/Redis chỉ bind 127.0.0.1 | Cài Postgres/Redis trực tiếp trên máy       |

## Lý do

- **Tiền là số nguyên VND:** VND không có phần lẻ; số nguyên tránh sai số dấu phẩy động, JSON trả ra là số (Prisma trả `Decimal` dưới dạng chuỗi). `INTEGER` chứa được tới ~2,1 tỷ đồng mỗi giá trị, đủ cho một đơn hàng bán lẻ.
- **UUID cho đơn hàng và người dùng:** id lộ ra ngoài (URL theo dõi đơn, kênh realtime F02) không đoán được, không lộ số lượng đơn. Mã `SF-000001` chỉ để hiển thị. Danh mục, sản phẩm dùng SERIAL cho URL gọn và index nhỏ; không có rủi ro lộ dữ liệu khi id bị đoán.
- **CHECK ở DB là lớp chặn cuối:** kể cả khi code có lỗi hoặc có người sửa tay trong DB, PostgreSQL vẫn từ chối tồn kho âm. Kết hợp với `UPDATE … WHERE stock >= qty` (ADR-0001) thì hai đơn đồng thời không bán vượt.
- **Snapshot giá:** giá sản phẩm thay đổi (F04 làm mới cache) không làm sai tổng tiền đơn cũ.
- **Enum vai trò:** SRS chỉ có 4 vai trò cố định; enum đơn giản và kiểm tra được bằng guard. Khi cần phân quyền chi tiết hơn thì tách bảng.
- **Seed xác định:** cùng dữ liệu ở mọi máy nên test, kịch bản demo và tài liệu (ví dụ "categoryId=1 là Điện thoại") luôn đúng.
- **Compose dev:** cùng image, cùng mạng nội bộ như production; api gọi DB bằng tên service. Cổng DB/Redis publish chỉ cho công cụ trên máy dev và chỉ trên loopback.

## Index cho catalog (bổ sung, migration `catalog_indexes`)

Truy vấn của `GET /api/products`: lọc `category_id` / `brand_id` (bằng), khoảng `price`, sắp xếp `newest` / `price_asc` / `price_desc` / `name_asc`, luôn kèm `id` làm khoá phụ.

| Index                   | Phục vụ                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `(category_id, price)`  | Lọc danh mục kèm khoảng giá hoặc sắp theo giá trong danh mục – trường hợp phổ biến nhất. Cột đầu vẫn dùng cho lọc riêng `category_id` và cho khoá ngoại |
| `(brand_id, price)`     | Tương tự cho trang thương hiệu                                                                                                                          |
| `(price)`               | Lọc/sắp theo giá trên toàn bộ catalog, không kèm danh mục                                                                                               |
| `(created_at DESC, id)` | Sắp xếp mặc định `newest` có phân trang; khớp đúng thứ tự `ORDER BY created_at DESC, id`                                                                |
| `sku`, `slug` (unique)  | Tra cứu theo mã sản phẩm (trợ lý AI F01), URL thân thiện                                                                                                |

Hai index đơn cột `category_id`, `brand_id` cũ bị bỏ vì index ghép đã bao phủ chúng (cột đầu tiên). Mỗi index làm chậm thêm một chút khi ghi, nhưng `products` là bảng đọc nhiều ghi ít. Với 200 dòng seed, planner vẫn chọn seq scan (rẻ hơn); index phát huy khi catalog lớn. Kiểm bằng `EXPLAIN` với `SET enable_seqscan = off`. Không thêm index cho `name` vì sắp theo tên ít dùng; khi có tìm kiếm theo tên sẽ dùng full-text/trigram (ADR riêng).

## Đánh đổi

- `INTEGER` không dùng được cho tiền tệ có phần lẻ (USD). Khi mở rộng đa tiền tệ cần migration sang `BIGINT` theo đơn vị nhỏ nhất kèm cột `currency`.
- UUID làm index lớn hơn và không sắp xếp được theo thời gian; sắp xếp đơn dùng `created_at` (đã có index `(user_id, created_at)`).
- Prisma schema chưa biểu diễn được CHECK, nên ràng buộc được thêm tay vào `migration.sql`. Migration về sau sinh bằng `prisma migrate dev` phải được review để không vô tình xoá ràng buộc này.
- Image api bản dev giữ devDependencies (nặng hơn) để chạy seed trong container.
- Seed xoá sạch dữ liệu; chỉ dùng cho dev/demo, đã chặn khi `NODE_ENV=production`.

## Xử lý khi sự cố

- **Container api không lên được / unhealthy:** compose chỉ khởi động api khi postgres và redis đã healthy. Nếu migration lỗi, container dừng trước khi nhận request; đọc lỗi bằng `docker compose logs api`.
- **Postgres hỏng dữ liệu ở dev:** `docker compose down -v && docker compose up -d`, sau đó chạy lại seed (dưới 1 phút).
- **Vi phạm CHECK khi đặt hàng:** Prisma ném lỗi; repository chuyển thành `AppException(409, 'OUT_OF_STOCK', …)` để trả thông điệp tiếng Việt thay vì lỗi 500.
- **Lộ cổng DB:** cổng chỉ bind 127.0.0.1 và có mật khẩu; compose production không có mục `ports` cho postgres/redis.
