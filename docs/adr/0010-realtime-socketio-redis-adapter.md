# ADR-0010: Realtime theo dõi đơn bằng Socket.IO + Redis adapter

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-30

## Bối cảnh

F02: khách xem trạng thái đơn của mình thay đổi theo thời gian thực. Nhân viên (CSKH, kho, admin) cũng theo dõi được mọi đơn.

Ràng buộc:

- **Chỉ người có quyền mới nhận được cập nhật.** Khách A không được biết gì về đơn của khách B, kể cả việc đơn đó có tồn tại hay không. Luật này đã có ở `GET /orders/:id` (ADR-0006).
- **Kết nối phải được xác thực ngay khi mở**, bằng chính access token JWT của HTTP (ADR-0003). Không truy vấn DB ở mỗi kết nối.
- **API chạy nhiều instance.** Khi deploy blue-green, xanh và lục chạy song song. Request đổi trạng thái có thể vào instance khác với instance đang giữ socket của khách.
- **Mạng di động chập chờn, deploy làm rớt kết nối.** Client phải tự nối lại, tự đăng ký lại và không bỏ sót trạng thái cuối cùng.
- **Độ trễ** từ lúc đổi trạng thái tới lúc khách thấy phải dưới 1 giây.
- Event `order.status_changed` đã phát sau commit, kèm `userId`, `from`, `to` (ADR-0004, ADR-0006).

## Lựa chọn

**Socket.IO** qua `@nestjs/websockets` + `@nestjs/platform-socket.io`, adapter **`@socket.io/redis-adapter`** trên Redis đã có (`modules/realtime/`).

| Thành phần               | Vai trò                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RedisIoAdapter`         | Gắn redis-adapter vào server Socket.IO trong `configureApp`. Dùng 2 kết nối ioredis riêng (pub, sub), không dùng `REDIS_CLIENT`.                        |
| `OrdersGateway`          | Tầng "controller" tại `/socket.io`: middleware handshake, nhận `order:subscribe` / `order:unsubscribe`, `join`/`leave` room. Không chứa luật nghiệp vụ. |
| `OrderTrackingService`   | Xác thực token, kiểm quyền subscribe, giới hạn số đơn mỗi kết nối.                                                                                      |
| `OrderRealtimeListener`  | `order.status_changed` → `order:updated` vào room `order:<orderId>`.                                                                                    |
| `apps/web/src/realtime/` | `OrderSocketClient` (không phụ thuộc React) và hook `useOrderTracking`.                                                                                 |

**Luồng:**

1. **Handshake:** client gửi token trong `auth.token` (hoặc header `Authorization: Bearer`). Middleware gọi `TokenService.verifyAccessToken`.
   - Sai, thiếu hoặc hết hạn: từ chối kết nối. Client nhận `connect_error` với `data = { code, message }` tiếng Việt (`UNAUTHENTICATED`, `TOKEN_EXPIRED`).
   - Hợp lệ: lưu user vào `socket.data` và hẹn ngắt kết nối đúng lúc token hết hạn.
2. **`order:subscribe { orderId }`:** kiểm UUID, kiểm số đơn đang theo dõi (`WS_MAX_SUBSCRIPTIONS`), rồi gọi **`OrdersService.findOne(user, orderId)`**, đúng luật của HTTP (chủ đơn hoặc nhân viên).
   - Không có quyền: ack `{ ok: false, error: { code: 'ORDER_NOT_FOUND' } }`, giống 404 của HTTP.
   - Có quyền: `join('order:<id>')`, ack `{ ok: true, order: { id, code, status } }` kèm **trạng thái hiện tại**.
3. **Đổi trạng thái:** `OrdersService.changeStatus` phát `order.status_changed` sau commit. Listener `emit` **chỉ vào room** của đơn với `{ orderId, code, from, to, occurredAt }`. Redis adapter chuyển tin sang các instance khác; instance nào giữ socket trong room thì gửi xuống.
4. **Client mẫu:**
   - Mỗi lần `connect` (kể cả nối lại) gửi lại `order:subscribe` cho mọi đơn đang theo dõi; ack cập nhật trạng thái mới nhất.
   - Server chủ động ngắt hoặc từ chối handshake: tự hẹn nối lại với backoff, gọi lại `getAccessToken` để lấy token mới.

**Chỉ transport websocket** (cả server và client), không dùng long-polling.

## Lý do

- **Socket.IO** có sẵn room, ack, tự nối lại có backoff và adapter nhiều instance. Tự dựng trên `ws` thì phải viết lại tất cả. SSE chỉ một chiều, không có room hay ack, nên vẫn phải tự làm kiểm quyền theo kênh.
- **Redis adapter** dùng Redis đã có trong stack (cache, rate limit, BullMQ), không thêm hạ tầng. Instance xanh và lục nối cùng Redis là emit qua được nhau, nên khi chuyển traffic không cần chuyển giao trạng thái room.
- **Xác thực tại handshake bằng `TokenService`:** access token stateless (ADR-0003), kiểm chữ ký trong bộ nhớ, không tốn query. Socket chưa xác thực không bao giờ được thiết lập, nên không có message nào chạy mà thiếu user.
- **Kiểm quyền khi join room, bằng `OrdersService.findOne`:** chỉ một luật cho HTTP và realtime, sửa một chỗ. Emit chỉ vào room nên không thể lọt sang socket khác, kể cả socket khác của cùng user khi chưa subscribe. Trả `ORDER_NOT_FOUND` thay cho "không có quyền" để không lộ đơn có tồn tại hay không.
- **Ack mang trạng thái hiện tại:** pub/sub và socket đều at-most-once. Thay vì cố đảm bảo không mất sự kiện (outbox, offset), mỗi lần subscribe, kể cả sau khi nối lại, client nhận ngay trạng thái thật trong DB. Sự kiện lỡ khi mất mạng không làm client hiển thị sai.
- **Ngắt khi token hết hạn:** socket không sống lâu hơn quyền. Đổi vai trò hoặc khoá tài khoản có hiệu lực trong tối đa `JWT_ACCESS_TTL`, giống HTTP.
- **Chỉ websocket:** long-polling gồm nhiều request HTTP riêng lẻ, sau load balancer phải sticky session để cùng vào một instance. Chỉ dùng websocket thì một kết nối TCP gắn với một instance, không cần sticky. Mọi trình duyệt hiện đại đều hỗ trợ.
- **Global guard bỏ qua context không phải HTTP:** `JwtAuthGuard`, `RolesGuard` và `AppThrottlerGuard` là `APP_GUARD` nên Nest chạy cả cho message WebSocket. Ở đó không có header HTTP, nên guard sẽ từ chối nhầm. Socket đã xác thực ở handshake; hạn mức message được thay bằng `WS_MAX_SUBSCRIPTIONS`.

Đo trên e2e (Postgres + Redis thật, máy dev): từ lúc gửi `PATCH /orders/:id/status` tới lúc client nhận `order:updated` khoảng **40ms**, kể cả qua instance thứ hai.

## Đánh đổi

- **Pub/sub giữa instance là at-most-once.** Redis rớt đúng lúc emit thì client ở instance khác không nhận được sự kiện đó. Client cùng instance vẫn nhận, vì adapter gửi local trước khi publish. Client sẽ có trạng thái đúng ở lần subscribe lại hoặc tải lại trang.
- **Quyền chỉ kiểm lúc join.** Chủ đơn không đổi, nhân viên bị hạ quyền thì bị ngắt khi token hết hạn. Trong khoảng đó (tối đa `JWT_ACCESS_TTL`, mặc định 15 phút) vẫn nhận được cập nhật của đơn đã join. Chấp nhận được vì dữ liệu gửi đi chỉ có mã đơn và trạng thái.
- **Không hỗ trợ long-polling:** mạng hoặc proxy chặn WebSocket thì không kết nối được, khách vẫn xem trạng thái bằng cách tải lại trang (HTTP).
- **Thêm 2 kết nối Redis mỗi instance** (pub và sub của adapter).
- **`redis-adapter` không bắt lỗi `publish`:** Redis sập thì promise bị từ chối không ai xử lý và Node dừng process. `RedisIoAdapter` bọc `publish` (`guardPublish`) để chỉ log. Kết nối pub tắt offline queue: tin cũ gửi muộn sau khi Redis lên lại cũng vô ích.
- **Hợp đồng sự kiện khai báo hai nơi:** `realtime.events.ts` (API) và `order-socket.ts` (web), vì chưa có package dùng chung. Đổi một bên phải đổi bên kia; e2e chạy chính client web nên lệch sẽ bị phát hiện.
- **Không giới hạn tần suất message socket:** chỉ giới hạn số đơn theo dõi và mỗi subscribe là một query theo khoá chính. Cần chặt hơn thì thêm hạn mức theo `socket.data.user`.

## Xử lý khi sự cố

- **Redis down:**
  - Socket.IO vẫn nhận kết nối mới và emit tới client cùng instance.
  - Log cảnh báo `Socket.IO Redis pub/sub error` và `broadcast to other instances failed`.
  - Kết nối sub tự nối lại và tự đăng ký lại kênh khi Redis lên lại; không cần khởi động lại API.
- **Deploy blue-green:**
  - Instance cũ nhận SIGTERM thì `app.close()` đóng server Socket.IO. Client nhận `io server disconnect`, tự nối lại (vào instance mới qua load balancer) và tự subscribe lại.
  - Ack mang trạng thái mới nhất nên thay đổi xảy ra trong lúc chuyển không bị mất trên màn hình.
- **Client không kết nối được qua Nginx** (lỗi 400 hoặc kết nối đóng ngay): thiếu header `Upgrade`/`Connection` ở `location /socket.io/` (`infra/nginx/api.conf`), hoặc `proxy_read_timeout` quá ngắn làm socket rảnh bị cắt.
- **Khách báo không thấy cập nhật:**
  - Kiểm ack subscribe trả `ok: false` (sai quyền hay sai id).
  - Bật log debug `OrdersGateway` (`Emitted order:updated for order …`).
  - Kiểm event `order.status_changed` có được phát không (ADR-0004).
- **Muốn tắt realtime khẩn cấp:** chặn `location /socket.io/` ở Nginx. Client thấy `reconnecting`; dữ liệu đơn qua HTTP không bị ảnh hưởng.
