# ADR-0005: Khoá tồn kho khi đặt hàng – UPDATE nguyên tử có điều kiện

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-29

## Bối cảnh

F06: "Giỏ hàng và đặt đơn, có kiểm tra tồn kho trước khi xác nhận, **không cho phép bán vượt số lượng thực tế**." ShopFast có flash sale: hàng trăm khách cùng bấm "Đặt hàng" cho một sản phẩm còn vài cái. Yêu cầu:

- Không bao giờ bán vượt, tồn kho không bao giờ âm.
- Một đơn có nhiều sản phẩm: thiếu bất kỳ sản phẩm nào thì **không trừ sản phẩm nào** (all-or-nothing), báo rõ sản phẩm thiếu.
- Đặt hàng p95 < 300 ms. Hệ thống chạy được trên một PostgreSQL 16, có thể nhiều instance api.
- Bấm "Đặt hàng" hai lần không tạo hai đơn.

Kiểm chứng bắt buộc: 20 request đồng thời mua một sản phẩm còn 5 cái → đúng 5 đơn, tồn kho 0, không âm (`apps/api/test/orders.e2e-spec.ts`).

## Lựa chọn

| #   | Cách                                                                                                                                 | Đúng khi đồng thời? | Vấn đề chính                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Đọc tồn kho trong app → kiểm `stock >= qty` → `UPDATE stock = :newValue`                                                             | ❌                  | Race: hai request cùng đọc 5, cùng ghi 4 → bán vượt (lost update)                                             |
| 2   | `SELECT … FOR UPDATE` (khoá bi quan) rồi kiểm trong app rồi `UPDATE`                                                                 | ✅                  | Thêm một round-trip giữ khoá; dễ quên khoá ở một luồng; giữ connection lâu hơn khi tranh chấp                 |
| 3   | Optimistic lock: cột `version`, `UPDATE … WHERE version = :v`, thất bại thì đọc lại và thử lại                                       | ✅                  | Sản phẩm hot → phần lớn request thất bại và retry liên tục (retry storm), độ trễ khó đoán                     |
| 4   | **`UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty`, kiểm số dòng bị ảnh hưởng, trong một transaction** ✅ | ✅                  | Xem Đánh đổi                                                                                                  |
| 5   | Isolation `SERIALIZABLE` và retry khi lỗi serialization                                                                              | ✅                  | Tỉ lệ abort cao đúng lúc tải cao; mọi truy vấn trong transaction chịu chi phí                                 |
| 6   | Giữ tồn kho trong Redis (`DECRBY` / Lua script), DB cập nhật sau                                                                     | ✅ (trên Redis)     | Hai nguồn sự thật, lệch nhau khi Redis mất dữ liệu hoặc ghi DB lỗi; trái yêu cầu "Redis sập vẫn phục vụ được" |
| 7   | Đưa mọi đơn vào hàng đợi, một worker xử lý tuần tự                                                                                   | ✅                  | Khách không biết kết quả ngay (phải poll/realtime), thêm hạ tầng; quá mức cho quy mô hiện tại                 |

## Lý do chọn (4)

- **Kiểm và trừ trong cùng một câu lệnh.** PostgreSQL khoá dòng khi `UPDATE`. Request đến sau phải chờ request trước commit, rồi **đánh giá lại điều kiện `stock >= :qty` trên phiên bản mới nhất của dòng** (cơ chế EvalPlanQual ở mức READ COMMITTED mặc định). Không có khoảng hở giữa "kiểm" và "ghi" nên không thể bán vượt, và không cần retry.
- **Số dòng bị ảnh hưởng là câu trả lời.** `1` = trừ được; `0` = không đủ hàng. Không cần đọc tồn kho trước. Code dùng `tx.$executeRaw` để câu SQL đúng như mô tả và trả về số dòng (`OrdersRepository.createFromCart`).
- **Rollback toàn bộ cho đơn nhiều sản phẩm.** Mọi lệnh trừ chạy trong một `prisma.$transaction`. Có sản phẩm thiếu thì repository ném lỗi nội bộ, transaction rollback, các sản phẩm đã trừ được hoàn lại, đơn vừa chèn biến mất. Trước khi ném, repository gom **tất cả** sản phẩm thiếu để thông báo một lần: `Không đủ hàng: "Bàn phím E2E" (ORD-B) đã hết hàng, bạn đặt 1.`
- **Chống deadlock:** các dòng được trừ **theo `productId` tăng dần**. Hai đơn cùng chứa A và B luôn khoá A trước B, nên không có vòng chờ.
- **Lớp chặn cuối:** `CHECK (stock >= 0)` (ADR-0002). Kể cả code sai, DB vẫn từ chối tồn kho âm.
- **Một nguồn sự thật:** tồn kho chỉ nằm trong PostgreSQL. Redis chỉ làm cache (F04) và được làm mới qua event `product.updated` phát sau khi đặt hàng thành công.
- Đây cũng là cách cập nhật tồn kho thủ công ở catalog (`CatalogRepository.applyPatch`, ADR-0004), nên toàn hệ thống chỉ dùng một kiểu xử lý tồn kho.

### Thứ tự các bước trong transaction

1. `INSERT orders` (kèm `idempotency_key`) **trước tiên**. Request trùng key đồng thời bị chặn ở unique index `(user_id, idempotency_key)`: nó chờ request đầu commit rồi nhận lỗi trùng (`P2002`) **trước khi chạm vào kho**.
2. Trừ kho từng sản phẩm (theo `productId` tăng dần), kiểm số dòng bị ảnh hưởng.
3. Đọc giá của các dòng đang bị chính transaction khoá → giá ghi vào đơn khớp với thời điểm trừ kho.
4. `INSERT order_items`, cập nhật `total_amount`, xoá các dòng giỏ vừa đặt, `COMMIT`.
5. Sau commit: phát `order.created` và `product.updated` (ADR-0004).

### Idempotency-Key

- Client gửi header `Idempotency-Key` (8–100 ký tự, nên là UUID sinh một lần cho mỗi lần bấm "Đặt hàng"). Key là duy nhất theo **từng user**, lưu ở cột `orders.idempotency_key`.
- Đã có đơn với key đó → trả lại đơn, mã **200** và header `Idempotent-Replayed: true`, không trừ kho lần nữa. Tạo mới trả **201**.
- Hai request cùng key đến đồng thời: request thua bị unique index chặn (bước 1), transaction của nó rollback, rồi nó đọc và trả lại đơn của request thắng. Đã kiểm bằng 5 request đồng thời → đúng 1 đơn.

## Đánh đổi

| Đánh đổi                                                                                        | Giảm thiểu                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sản phẩm hot: mọi transaction xếp hàng trên **một dòng**; khoá giữ tới khi commit               | Transaction ngắn (khoảng 6 câu lệnh, không gọi dịch vụ ngoài, việc nặng như email/hoá đơn chạy sau commit qua event và queue F05). Đo thực tế: 20 request tranh nhau hoàn tất trong khoảng 2 giây trên Docker Desktop |
| Transaction chờ khoá vẫn giữ một connection của pool → tải cao có thể cạn pool (Prisma `P2028`) | `maxWait: 5s`, `timeout: 10s` cho transaction đặt hàng; `P2028` được trả **503 `ORDER_BUSY`** tiếng Việt thay vì 500; khi cần thì tăng `connection_limit` trong `DATABASE_URL` hoặc đặt PgBouncer phía trước          |
| Đơn bị từ chối vẫn tốn một transaction (INSERT rồi rollback)                                    | Kiểm "mềm" ở giỏ hàng (`POST /cart/items` báo hết hàng sớm) giảm số đơn chắc chắn thất bại                                                                                                                            |
| Idempotency-Key không so nội dung request: gửi lại key cũ sau khi đổi giỏ vẫn nhận đơn cũ       | Đúng mục đích chống bấm trùng. Client phải sinh key mới cho mỗi lần đặt. Muốn chặt hơn thì lưu hash nội dung giỏ và trả 422 khi khác                                                                                  |
| Key được giữ mãi trên đơn                                                                       | Chấp nhận (một cột text, nhiều NULL). Có thể xoá key của đơn cũ hơn 24 giờ bằng job (F05)                                                                                                                             |
| Mỗi request mở transaction tương tác qua nhiều round-trip, không phải một câu SQL duy nhất      | Đổi lại được rollback all-or-nothing cho đơn nhiều sản phẩm và code dễ đọc. Khi tranh chấp cực cao có thể gộp thành một CTE/stored procedure                                                                          |

## Xử lý khi sự cố

- **Phát hiện tồn kho âm:** không thể xảy ra nhờ `CHECK`. Nếu thao tác tay vô hiệu hoá ràng buộc, chạy đối soát `SELECT id, sku, stock FROM products WHERE stock < 0`.
- **Tồn kho lệch so với đơn** (nghi trừ sai): đối soát `stock` hiện tại với nhập kho và `SUM(order_items.quantity)`; mỗi lần trừ đều đi kèm `order_items` trong cùng transaction nên không có trường hợp trừ kho mà không có đơn.
- **503 `ORDER_BUSY` tăng vọt khi flash sale:** kiểm số connection (`pg_stat_activity`), tăng `connection_limit`/PgBouncer, hoặc bật rate limit riêng cho `POST /orders` (F03). Dữ liệu vẫn đúng, chỉ có request bị từ chối.
- **Deadlock (`40P01`):** không mong đợi vì khoá theo thứ tự `productId`. Nếu xuất hiện, PostgreSQL huỷ một transaction (rollback sạch) và client nhận lỗi; kiểm có luồng nào trừ kho không theo thứ tự.
- **Khách báo bị trừ tiền hai lần / có hai đơn:** tra `orders.idempotency_key`. Nếu client không gửi key thì đây là hai lần đặt thật; cần đảm bảo UI sinh key cho mỗi lần bấm.
- **Process chết giữa commit và phát event:** đơn và tồn kho trong DB vẫn đúng; chỉ email/cache bị trễ (xem ADR-0004).
