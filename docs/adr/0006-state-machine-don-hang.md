# ADR-0006: State machine trạng thái đơn hàng và lịch sử chuyển trạng thái

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-29

## Bối cảnh

F06: "cập nhật trạng thái đơn từ phía kho". F02: khách theo dõi trạng thái đơn theo thời gian thực. Yêu cầu:

- Trạng thái chỉ đi theo đường hợp lệ: `PENDING_PAYMENT → PAID → PROCESSING → SHIPPING → DELIVERED`, và `CANCELLED` từ các trạng thái cho phép. Chuyển sai trả **409**.
- Lưu lịch sử: ai đổi, đổi từ đâu sang đâu, lúc nào.
- Nhiều nhân viên kho thao tác cùng lúc trên một đơn không được ghi đè lên nhau.
- Phát event `order.status_changed` cho realtime và thông báo.

## Lựa chọn

### Bảng chuyển trạng thái

| Từ \ Sang       | PAID | PROCESSING | SHIPPING | DELIVERED | CANCELLED |
| --------------- | :--: | :--------: | :------: | :-------: | :-------: |
| PENDING_PAYMENT |  ✅  |            |          |           |    ✅     |
| PAID            |      |     ✅     |          |           |    ✅     |
| PROCESSING      |      |            |    ✅    |           |    ✅     |
| SHIPPING        |      |            |          |    ✅     |    ❌     |
| DELIVERED       |      |            |          |           |           |
| CANCELLED       |      |            |          |           |           |

- Không nhảy cóc, không lùi, không "chuyển" sang chính trạng thái hiện tại. `DELIVERED` và `CANCELLED` là trạng thái cuối.
- **Không huỷ khi đang giao (`SHIPPING`)**: hàng đã rời kho, huỷ lúc này là nghiệp vụ trả hàng/hoàn tiền (chưa thuộc phạm vi).
- Ai được đổi: `WAREHOUSE`, `ADMIN` (`PATCH /api/orders/:id/status`). Chưa có cổng thanh toán thật nên bước `PAID` do nhân viên xác nhận.

### Cách hiện thực

| Vấn đề                     | Phương án chọn                                                                                              | Phương án loại                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Nơi định nghĩa luật        | Bảng hằng `ORDER_TRANSITIONS` + hàm thuần `assertTransition` (`src/modules/orders/order-status.machine.ts`) | Rải `if` trong service/controller; thư viện state machine (XState…) |
| Chống ghi đè khi đồng thời | **Compare-and-set**: `UPDATE orders SET status = :to WHERE id = :id AND status = :from` (0 dòng → 409)      | Đọc rồi ghi (race); `SELECT … FOR UPDATE`; cột version              |
| Lịch sử                    | Bảng `order_status_history` **chỉ INSERT**, ghi trong cùng transaction với việc đổi trạng thái              | Chỉ log ra file; cột `updated_by` trên `orders` (mất lịch sử)       |
| Huỷ đơn                    | Hoàn kho (`stock = stock + qty`) trong cùng transaction, theo `productId` tăng dần                          | Hoàn kho bằng job sau đó                                            |

## Lý do

- **Một nguồn sự thật cho luật chuyển:** bảng 6×6 đọc được trong nháy mắt, được test đủ 36 cặp (`order-status.machine.spec.ts`). Bảng kỳ vọng trong test viết độc lập với bảng trong code, nên sửa nhầm code thì test bắt được. Thư viện state machine là quá mức cho 6 trạng thái không có side effect phức tạp.
- **Compare-and-set** (cùng tinh thần với UPDATE có điều kiện ở ADR-0005): service kiểm luật trên trạng thái vừa đọc, rồi câu `UPDATE` chỉ thành công nếu trạng thái **vẫn là** trạng thái vừa đọc. Hai nhân viên cùng bấm "Đang xử lý": PostgreSQL khoá dòng, request sau đánh giá lại `status = 'PAID'` trên phiên bản mới, thấy sai nên cập nhật 0 dòng. Request đó nhận `409 STATUS_CHANGED_CONCURRENTLY` kèm trạng thái hiện tại. Không có lịch sử ghi trùng, không phát event trùng, không cần khoá tường minh hay cột version.
- **Lịch sử cùng transaction:** không thể có trạng thái đổi mà thiếu dòng lịch sử, và ngược lại. Bảng chỉ INSERT nên là nhật ký kiểm toán. Ràng buộc `CHECK (from_status IS NULL OR from_status <> to_status)` chặn ghi bước chuyển giả. Lúc tạo đơn ghi dòng `null → PENDING_PAYMENT`.
- **Hoàn kho khi huỷ trong cùng transaction:** tồn kho luôn khớp với đơn còn hiệu lực. Compare-and-set bảo đảm huỷ đồng thời 5 lần chỉ hoàn kho **một lần** (có test e2e). Thứ tự `productId` tăng dần giống lúc đặt hàng nên không deadlock với checkout.
- **Quyền xem lịch sử:** nhân viên thấy `changedBy { id, fullName, role }`; chủ đơn chỉ thấy `role`, không lộ danh tính nhân viên.
- **Event sau commit** (ADR-0004): `order.status_changed { orderId, code, userId, from, to, changedBy, note }`. Có `userId` để F02 đẩy đúng kênh của chủ đơn. Khi huỷ còn phát `product.updated` cho mỗi sản phẩm được hoàn kho.

## Đánh đổi

| Đánh đổi                                                                                                                                            | Giảm thiểu                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Đọc trạng thái rồi mới compare-and-set: tốn thêm 1 query                                                                                            | Cần để báo lỗi rõ (nêu bước được phép) và để biết `from` cho lịch sử; truy vấn theo khoá chính rất rẻ                      |
| Request thua cuộc đua có thể nhận `INVALID_STATUS_TRANSITION` (nếu đọc sau khi người kia commit) hoặc `STATUS_CHANGED_CONCURRENTLY` (nếu đọc trước) | Cả hai đều là 409 và dữ liệu luôn đúng; thông điệp yêu cầu tải lại                                                         |
| Không huỷ được đơn `SHIPPING`                                                                                                                       | Chủ ý nghiệp vụ; trả hàng/hoàn tiền là luồng riêng sau này                                                                 |
| Đổi tên enum `SHIPPED` → `SHIPPING`                                                                                                                 | Migration dùng `ALTER TYPE … RENAME VALUE` (giữ dữ liệu, chạy tức thì) thay vì để Prisma tạo lại enum (lỗi với dữ liệu cũ) |
| Bảng lịch sử tăng liên tục (~5 dòng/đơn)                                                                                                            | Index `(order_id, created_at)`; lưu trữ/partition theo thời gian khi lớn                                                   |
| Customer chưa tự huỷ được đơn chưa thanh toán                                                                                                       | Bổ sung endpoint riêng cho customer, dùng chung `assertTransition` + `changeStatus`                                        |

## Xử lý khi sự cố

- **Đơn "kẹt"** (ví dụ `PENDING_PAYMENT` quá lâu): job nhắc/tự huỷ (F05) phải đi qua `OrdersService.changeStatus`, không `UPDATE` thẳng, để có lịch sử, hoàn kho và event.
- **Cần sửa tay trạng thái trong DB** (sự cố dữ liệu): luôn INSERT kèm một dòng `order_status_history` có `note` giải thích. Nếu huỷ thì hoàn kho thủ công theo `order_items`. Đối soát bằng `SELECT o.id FROM orders o WHERE o.status <> (SELECT to_status FROM order_status_history h WHERE h.order_id = o.id ORDER BY created_at DESC, id DESC LIMIT 1)`.
- **Nghi hoàn kho hai lần:** mỗi lần hoàn kho gắn với đúng một dòng lịch sử `→ CANCELLED`; đếm số dòng đó theo đơn phải ≤ 1.
- **Nhân viên báo "bấm mà báo lỗi 409":** người khác vừa đổi trước. Body có `details.current` là trạng thái hiện tại; tải lại đơn và xem lịch sử để biết ai đã đổi.
- **Listener `order.status_changed` lỗi:** không ảnh hưởng việc đổi trạng thái (đã commit). Client realtime nhận đúng trạng thái khi tải lại hoặc kết nối lại.
