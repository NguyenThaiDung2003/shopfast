# ADR-0012: Health check (readiness/liveness) và tắt êm cho zero-downtime deploy

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-30

## Bối cảnh

Deploy blue-green (ADR-0010) cần hai thứ từ mỗi instance API:

1. **Biết instance có phục vụ được không** để load balancer hay orchestrator chỉ gửi traffic tới instance sẵn sàng. `/api/health` cũ chỉ trả `ok`, không kiểm PostgreSQL hay Redis.
2. **Tắt mà không làm hỏng việc đang dở**: request đang chạy, job BullMQ đang chạy (gửi email, xuất hoá đơn, đồng bộ đối tác – ADR-0009), kết nối WebSocket.

Kiểm tra code hiện có cho thấy cơ chế tắt **chưa hoạt động** dù đã gọi `enableShutdownHooks()`:

- **SIGTERM không tới Node.** `CMD ["sh","-c","npx prisma migrate deploy && node dist/main"]` làm `sh` thành PID 1. `sh` không chuyển SIGTERM cho tiến trình con, nên Docker chờ 10 giây rồi SIGKILL: job đang chạy bị cắt, request dở dang mất.
- **Đóng kết nối sai thứ tự.** Nest 10 `app.close()` chạy `onModuleDestroy` → `beforeApplicationShutdown` → đóng HTTP server → `onApplicationShutdown`. `PrismaService` và `RedisModule` lại đóng ở `onModuleDestroy`, tức trước khi ngừng nhận request.
- **Worker đóng muộn hơn DB.** `@nestjs/bullmq` chỉ đóng worker ở `onApplicationShutdown`, sau khi DB đã bị ngắt, nên job đang chạy lỗi giữa chừng.

Ràng buộc từ các ADR trước: Redis chỉ là lớp tăng tốc hoặc phụ trợ (cache, rate limit, khoá đăng nhập, OTP – ADR-0007, ADR-0008). Redis lỗi thì ứng dụng **suy giảm có kiểm soát**, không ngừng phục vụ.

## Lựa chọn

**`@nestjs/terminus` (v10, cho Nest 10)**, cùng hai endpoint ngoài tiền tố `/api` (endpoint cho hạ tầng, giống `/docs`, `/admin/queues`):

| Endpoint           | Kiểm                                                                    | Dùng cho                                                       |
| ------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /health/live` | Không gì cả: process sống                                               | Liveness – restart container khi treo                          |
| `GET /health`      | PostgreSQL + Redis, song song, mỗi kiểm tra ≤ `HEALTH_CHECK_TIMEOUT_MS` | Readiness – healthcheck Docker, load balancer, cổng blue-green |

**Trạng thái của `GET /health`:**

| Tình huống        | HTTP | `status` / `details.status` |
| ----------------- | ---- | --------------------------- |
| DB + Redis ổn     | 200  | `ok`                        |
| Redis lỗi, DB ổn  | 200  | `degraded`                  |
| DB lỗi            | 503  | `error`                     |
| Instance đang tắt | 503  | `shutting_down`             |

- DB dùng `PrismaHealthIndicator` của terminus (`SELECT 1`); Redis dùng `RedisHealthIndicator` (PING trên `REDIS_CLIENT`).
- Lỗi trả qua `AppException` nên body đúng chuẩn chung, thông điệp tiếng Việt. `details.checks` chỉ có `up`/`down` và `latencyMs`; chuỗi lỗi hạ tầng chỉ ghi log.
- `/api/health` cũ chuyển hướng 308 sang `/health` (deprecated).

**Tắt êm** (`ShutdownService`, `WorkersBootstrapService`), theo đúng thứ tự hook của Nest:

1. **SIGTERM tới được Node:** `CMD` dùng `exec node dist/main`; compose có `init: true` (tini làm PID 1, chuyển tín hiệu) và `stop_grace_period: 35s`.
2. **`onModuleDestroy`** (hook đầu tiên): bật cờ draining, `/health` trả 503 `shutting_down`. Hẹn giờ cứng `SHUTDOWN_TIMEOUT_MS` (25s): quá hạn thì log lỗi và `process.exit(1)`.
3. **`beforeApplicationShutdown`:**
   - Chờ `SHUTDOWN_DRAIN_MS` (5s); request vẫn được phục vụ bình thường trong lúc chờ.
   - Worker chờ mốc drain (`ShutdownService.drained()`) rồi `worker.close()` không ép: ngừng nhận job mới và **chờ job đang chạy xong**, trong khi DB và Redis vẫn mở.
4. **Nest đóng HTTP server và Socket.IO:**
   - Node 20 `server.close()` chờ request đang chạy và đóng kết nối keep-alive rảnh.
   - Client WebSocket bị ngắt, tự nối lại sang instance mới (ADR-0010).
5. **`onApplicationShutdown`:** `PrismaService.$disconnect()` và `REDIS_CLIENT.quit()` (dời từ `onModuleDestroy`). BullMQ tự đóng queue và connection.

## Lý do

- **Tách readiness và liveness:** DB chết thì restart container cũng không giúp gì. Nếu liveness kiểm DB, orchestrator sẽ restart liên tục mọi instance cùng lúc. Liveness chỉ trả lời "process còn chạy không".
- **Redis lỗi là `degraded` 200, không phải 503:** mọi chỗ dùng Redis đã có đường suy giảm (cache đọc DB, rate limit cho qua, OTP trả 503 riêng). Nếu readiness trả 503, load balancer sẽ rút **toàn bộ** instance khi Redis sập, biến lỗi một tính năng phụ thành sập toàn hệ thống. `degraded` vẫn cho người vận hành và giám sát thấy sự cố.
- **DB lỗi là 503:** gần như mọi request cần DB, nên gửi traffic tới instance không có DB chỉ sinh lỗi.
- **Drain trước khi đóng:** load balancer phát hiện instance không sẵn sàng qua healthcheck định kỳ. Nếu đóng HTTP ngay lúc nhận SIGTERM, các request được định tuyến tới trong khoảng đó sẽ bị từ chối kết nối. Trả 503 ở `/health` mà vẫn phục vụ request thật trong `SHUTDOWN_DRAIN_MS` giúp chuyển traffic không rơi request nào.
- **Đóng kết nối ở hook cuối cùng:** request và job đang chạy cần DB/Redis tới khi chúng xong. Chỉ `onApplicationShutdown` chạy sau khi HTTP server và worker đã đóng.
- **Worker đóng sau drain, trước HTTP:** job chạy song song với request; đóng worker sớm giúp tổng thời gian tắt ≈ max(drain, job dài nhất) thay vì cộng dồn.
- **Hẹn giờ cứng:** một job treo không được giữ instance cũ sống mãi (deploy kẹt). Đặt nhỏ hơn `stop_grace_period` để tự thoát có log, thay vì bị SIGKILL im lặng.
- **terminus:** indicator DB có sẵn, kiểu `HealthIndicator` chuẩn để thêm phụ thuộc mới, và là thư viện chuẩn của hệ sinh thái Nest. Không dùng `HealthCheckService.check()` vì nó ném `ServiceUnavailableException` với body riêng, khác chuẩn lỗi của dự án, và không có khái niệm `degraded`.

## Đánh đổi

- **Tắt chậm hơn ít nhất `SHUTDOWN_DRAIN_MS` (5s)** mỗi lần deploy hay restart. Môi trường không có load balancer có thể đặt 0 (test đặt 0).
- **Job dài hơn `SHUTDOWN_TIMEOUT_MS`** bị cắt khi tắt. BullMQ đánh dấu stalled và chạy lại ở instance khác; an toàn vì job idempotent (jobId cố định, `email_deliveries` – ADR-0009). Job có thể chạy dài hơn 20 giây thì phải chia nhỏ hoặc tăng giới hạn kèm `stop_grace_period`.
- **Request dài hơn thời gian còn lại** cũng bị cắt khi hẹn giờ cứng kích hoạt. API hiện không có request nào như vậy.
- **`/health` tốn một truy vấn DB và một lệnh Redis mỗi lần gọi** (healthcheck 10 giây một lần): không đáng kể.
- **`HealthService` inject `PrismaService`** chỉ để truyền cho indicator (`SELECT 1`). Đây là ngoại lệ có chủ đích của luật "service không inject Prisma"; không có truy vấn nghiệp vụ nào ở đây.
- **Đổi đường dẫn health:** `/api/health` vẫn chạy qua chuyển hướng 308. Công cụ không theo redirect cần đổi sang `/health`.

## Xử lý khi sự cố

- **Container `unhealthy`:** gọi `curl -i localhost:3000/health`. `details.checks` cho biết DB hay Redis lỗi; log `Health check database down: …` có chi tiết.
- **Redis sập:** `/health` 200 `degraded`, container vẫn healthy, traffic vẫn chạy. Theo dõi log `Redis error` và khôi phục Redis; không cần restart API.
- **Deploy treo khi dừng instance cũ:** log có `Shutdown: draining…`, `closing N workers…`, nhưng không có `workers closed`. Một job đang chạy quá lâu; sau `SHUTDOWN_TIMEOUT_MS` sẽ có `Shutdown exceeded …, forcing exit`. Xem job đó trên Bull Board (`/admin/queues`).
- **Container bị SIGKILL (exit code 137) thay vì tự thoát:** SIGTERM không tới được Node (thiếu `exec` hoặc `init`), hoặc `stop_grace_period` nhỏ hơn `SHUTDOWN_TIMEOUT_MS`.
- **Load balancer vẫn gửi request sau khi đóng:** tăng `SHUTDOWN_DRAIN_MS` lên ít nhất bằng chu kỳ healthcheck × số lần thất bại để rút instance.
