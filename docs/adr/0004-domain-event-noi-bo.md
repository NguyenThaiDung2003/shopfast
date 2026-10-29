# ADR-0004: Domain event nội bộ bằng @nestjs/event-emitter

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-29

## Bối cảnh

Khi giá hoặc tồn kho của sản phẩm thay đổi (`PATCH /api/products/:id`), nhiều phần khác của hệ thống cần phản ứng:

- F04: làm mới mọi bản ghi cache liên quan ngay lập tức, khách không được thấy giá cũ.
- F02: đẩy cập nhật realtime tới người đang xem.
- Sau này: ghi audit, đồng bộ tồn kho với đối tác (F05).

Nếu `CatalogService` gọi thẳng từng service đó, module catalog sẽ phụ thuộc vào cache, realtime, queue… Mỗi tính năng mới lại phải sửa catalog, và unit test phải mock tất cả.

## Lựa chọn

1. Gọi trực tiếp `CacheService`, `RealtimeGateway`… trong `CatalogService`.
2. **Domain event in-process bằng `@nestjs/event-emitter` (EventEmitter2)** ✅
3. Redis Pub/Sub hoặc stream để phát event giữa các process.
4. Đẩy job vào BullMQ cho mọi listener.

## Lý do

- **Tách phụ thuộc:** catalog chỉ biết phát `product.updated`. Cache, realtime, audit tự đăng ký `@OnEvent('product.updated')` trong module của mình; thêm listener không phải sửa catalog.
- **Đơn giản, đủ dùng:** hiện chỉ có một instance api (một container trên EC2). Event in-process không cần hạ tầng thêm, độ trễ gần như bằng 0, phù hợp mục tiêu realtime < 1 giây.
- **Có sẵn trong hệ sinh thái Nest:** tích hợp DI, hỗ trợ wildcard, listener async.
- Redis Pub/Sub hoặc BullMQ (phương án 3, 4) chỉ cần khi có nhiều instance, hoặc khi listener là việc nặng cần retry. Khi đó listener in-process sẽ đẩy tiếp sang queue hoặc pub/sub, còn catalog không phải sửa.

### Quy ước

- Tên event `<aggregate>.<động từ quá khứ>`: `product.updated`. Hằng số và class payload đặt trong `modules/<module>/events/`.
- **Chỉ phát sau khi DB đã commit**. `CatalogRepository.applyPatch` là một câu `UPDATE` nguyên tử, nên khi service phát event thì dữ liệu đã bền. Không phát khi thao tác thất bại hoặc khi không có trường nào thực sự đổi.
- Payload chứa giá trị cũ và mới (`changes.price.from/to`, `changes.stock.from/to`), người thực hiện và thời điểm, để listener không phải đọc lại DB.
- Listener đăng ký `@OnEvent(PRODUCT_UPDATED, { async: true, suppressErrors: true })` và tự bắt lỗi. Lỗi ở listener không làm hỏng request cập nhật.

## Đánh đổi

| Đánh đổi                                                                       | Giảm thiểu                                                                                                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process chết giữa lúc commit DB và lúc phát event → mất event                  | Cache có TTL nên tự hết hạn; nếu cần bảo đảm tuyệt đối thì chuyển sang transactional outbox (ghi event vào bảng trong cùng transaction, worker phát lại) |
| Chỉ có hiệu lực trong một process: nhiều instance thì instance khác không nhận | Listener realtime dùng Socket.IO Redis adapter; cache invalidation xoá key trên Redis dùng chung nên mọi instance đều thấy                               |
| Listener chạy trong cùng process với request, việc nặng làm chậm event loop    | Listener nặng (gửi email, đồng bộ đối tác) chỉ đẩy job vào BullMQ (F05) rồi trả về ngay                                                                  |
| Luồng xử lý gián tiếp, khó lần theo hơn gọi hàm trực tiếp                      | Tên event là hằng số dùng chung; tìm `PRODUCT_UPDATED` ra mọi nơi phát và nghe                                                                           |

## Xử lý khi sự cố

- **Listener ném lỗi:** `suppressErrors` cùng try/catch trong listener ghi log lỗi; request PATCH vẫn trả 200 vì dữ liệu đã lưu đúng. Cache cũ tự hết hạn theo TTL.
- **Khách thấy giá cũ sau khi admin đổi giá:** kiểm tra log listener cache invalidation; xoá thủ công key cache của sản phẩm. Tạm thời có thể hạ TTL.
- **Mất event do restart giữa chừng:** dữ liệu trong DB vẫn đúng. Client realtime sẽ nhận trạng thái đúng ở lần tải lại hoặc kết nối lại (F02 đăng ký lại kênh), cache hết hạn theo TTL.
- **Bão event** (cập nhật hàng loạt tồn kho): listener cache gom (debounce) theo `productId`; nhập hàng loạt về sau nên có endpoint batch phát một event tổng hợp.
