# ADR-0008: Rate limit trên Redis và khoá đăng nhập theo tài khoản mục tiêu

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-30

## Bối cảnh

F03: chống lạm dụng API và chống dò mật khẩu. Ràng buộc:

- API chạy **nhiều instance** sau Nginx. Bộ đếm trong RAM của từng process thì mỗi instance đếm riêng: chạy 3 instance là hạn mức thực tế nhân 3, và mỗi lần deploy bộ đếm về 0.
- Một số endpoint cần hạn mức chặt hơn mức chung: `POST /auth/login` (dò mật khẩu), `POST /auth/otp/send` (spam hộp thư, tốn chi phí gửi), đặt đơn khuyến mãi (bot vét hàng giá rẻ). Repo chưa có khái niệm khuyến mãi riêng nên hạn mức này đang gắn vào `POST /orders`.
- Sau Nginx, `req.ip` mặc định là IP của Nginx: mọi khách chung một bộ đếm.
- Vượt hạn mức phải trả 429 kèm `Retry-After` và thông điệp tiếng Việt có số giây phải chờ.
- **Dò mật khẩu hiện nay không đến từ một IP.** Credential stuffing và password spraying dùng botnet hoặc proxy dân dụng hàng nghìn IP, mỗi IP chỉ thử vài lần. Hạn mức theo IP không bao giờ chạm tới, dù một tài khoản đang bị thử hàng nghìn mật khẩu.

## Lựa chọn

**Hạn mức request:** `@nestjs/throttler` v6 với storage tự viết trên `REDIS_CLIENT` dùng chung (`modules/rate-limit/`).

- Một script Lua `INCR` + `PEXPIRE` (cửa sổ cố định) + khoá chặn `SET PX`. Một lệnh `EVAL` nên nguyên tử, các instance đếm chung một key.
- **Tracker:** `user:<id>` khi đã đăng nhập, `ip:<req.ip>` khi chưa. `AppThrottlerGuard` là guard toàn cục đăng ký **sau** `JwtAuthGuard` (`RateLimitModule` import sau `AuthModule`), nên đã có `request.user`.
- **Hạn mức `global`** áp cho mọi route. Key là `ratelimit:global:<tracker>`, không kèm tên route như mặc định của thư viện, nên đếm **gộp toàn API**.
- **Hạn mức riêng** (`login`, `otpSend`, `promoOrder`) chỉ áp cho route gắn `@RateLimit(tên)`, key `ratelimit:<tên>:<tracker>`. Mỗi hạn mức là một biến env dạng `<số request>/<giây>`.
- `/health`, `/health/live` bỏ qua (`@SkipThrottle`, ADR-0012).
- **IP thật:** `TRUST_PROXY` (Express `trust proxy`) bằng đúng số proxy đứng trước API. Nginx đặt `X-Forwarded-For $proxy_add_x_forwarded_for` ([infra/nginx/api.conf](../../infra/nginx/api.conf)).
- **429:** `AppException(429, 'TOO_MANY_REQUESTS', …, { retryAfterSeconds })`. `HttpExceptionFilter` đặt header `Retry-After` cho mọi 429 có `details.retryAfterSeconds`; header riêng của thư viện (`X-RateLimit-*`, `Retry-After-<tên>`) tắt.

**Khoá đăng nhập:** đếm số lần sai theo **email mục tiêu** (`LoginAttemptsService` / `LoginAttemptsRepository` trong `modules/auth/`).

- Sai `LOGIN_MAX_FAILED_ATTEMPTS` (5) lần trong `LOGIN_FAILURE_WINDOW_SECONDS` (15 phút) thì khoá. Thời gian khoá tăng dần theo `LOGIN_LOCKOUT_STEPS_SECONDS` = 1 phút → 5 phút → 30 phút, bước cuối lặp lại. Số lần đã bị khoá nhớ 24 giờ.
- Đang khoá: trả 429 `LOGIN_LOCKED` **trước** khi đọc DB và chạy bcrypt, kể cả khi mật khẩu đúng.
- Đăng nhập đúng: xoá bộ đếm, khoá và số lần đã bị khoá.
- Email không tồn tại cũng được đếm và khoá y hệt.
- Key là `auth:login:{fail|strikes|lock}:<sha256(email)>`. Ghi nhận lần sai bằng một script Lua nguyên tử.

Phương án đã loại:

- **Chỉ hạn mức theo IP cho login:** vô dụng trước botnet (xem Bối cảnh), và chặn oan cả văn phòng hoặc mạng di động dùng chung một IP NAT.
- **Khoá theo cặp (IP, email):** kẻ tấn công đổi IP là có thêm lượt thử cho cùng tài khoản. Chính điều cần chặn lại không chặn được.
- **Khoá vĩnh viễn, chờ admin mở:** biến tính năng an toàn thành công cụ tấn công từ chối dịch vụ, và tốn công hỗ trợ.
- **CAPTCHA sau vài lần sai:** tốt, nhưng cần dịch vụ ngoài và UI. Để giai đoạn sau, dùng chung bộ đếm này.
- **Gói `@nest-lab/throttler-storage-redis`:** tự tạo client riêng và ném lỗi khi Redis sập (làm API trả 500). Tự viết khoảng 40 dòng thì dùng lại được client, `commandTimeout` và chính sách fail-open đã có.

## Lý do

**Vì sao đếm theo tài khoản mục tiêu:** thứ cần bảo vệ là **mật khẩu của một tài khoản**, không phải băng thông của server. Số mật khẩu kẻ tấn công thử được cho một tài khoản chỉ bị giới hạn thật sự khi bộ đếm gắn với tài khoản đó.

- Với khoá theo email, dù dùng 10.000 IP, kẻ tấn công cũng chỉ thử được khoảng 5 mật khẩu mỗi lần khoá. Tính theo các bước 1, 5 rồi 30 phút lặp lại, mỗi ngày còn khoảng 5 × 48 ≈ 240 lần. Con số này quá ít để dò một mật khẩu đạt chính sách tối thiểu (8 ký tự, có chữ và số).
- Hạn mức theo IP vẫn giữ, để chặn chiều ngược lại: một nguồn thử **nhiều email** với vài mật khẩu phổ biến (spraying). Mỗi email chỉ sai 1–2 lần nên không chạm ngưỡng khoá, nhưng IP đó chạm hạn mức `login`.
- Hai lớp bù cho nhau: botnet bị chặn theo tài khoản, một nguồn đơn lẻ bị chặn theo IP.

**Các chi tiết còn lại:**

- **Khoá tăng dần** thay cho khoá dài ngay từ đầu: người dùng gõ nhầm chỉ mất 1 phút, còn kẻ dò liên tục thì nhanh chóng chỉ còn vài lượt mỗi giờ.
- **Kiểm khoá trước bcrypt:** trong lúc khoá không có kết quả mật khẩu nào bị lộ ra. Server cũng không tốn CPU cho bcrypt khi bị dò.
- **Email không tồn tại cũng bị khoá:** response y hệt email có thật, nên không dùng cơ chế khoá để dò ra email nào đã đăng ký. Điều này giống `compareDummy` của ADR-0003.
- **Băm email trong key:** Redis không chứa danh sách email đang bị tấn công dưới dạng đọc được.
- **Hạn mức chung đếm gộp toàn API:** mục tiêu là giới hạn tổng tải một client gây ra. Mặc định của thư viện đếm riêng từng route, nên client gọi 50 route khác nhau sẽ có hạn mức gấp 50 lần.
- **Đếm theo userId khi đã đăng nhập:** nhiều khách sau cùng một NAT không chặn lẫn nhau, còn một tài khoản đổi IP cũng không lách được.

## Đánh đổi

- **Kẻ xấu có thể cố ý khoá tài khoản người khác** chỉ bằng cách biết email và gửi mật khẩu sai. Đây là cái giá cố hữu của khoá theo tài khoản. Cách giảm thiểu:
  - Khoá ngắn và có trần 30 phút, không bao giờ vĩnh viễn.
  - Hạn mức `login` theo IP làm việc khoá hàng loạt từ một nguồn tốn công hơn.
  - Phiên đang đăng nhập (refresh token) không bị ảnh hưởng, người dùng vẫn mua hàng được.
  - Hướng mở rộng: cho người dùng tự mở khoá qua OTP email (đã có `OtpService`), hoặc với IP/thiết bị đã từng đăng nhập thành công thì chỉ yêu cầu CAPTCHA thay vì khoá.
- **Fail-open khi Redis lỗi hoặc timeout:** trong lúc Redis sập không có hạn mức lẫn khoá đăng nhập. Ta chọn cho API và đăng nhập tiếp tục chạy (bcrypt vẫn làm chậm việc dò), thay vì chặn mọi người dùng thật. Thời gian lộ giới hạn đúng bằng thời gian Redis sập, và log có cảnh báo. Request đến khi client Redis đang kết nối lại (ví dụ ngay sau khởi động) cũng được cho qua mà không đếm.
- **Cửa sổ cố định:** cho phép tới 2× hạn mức quanh ranh giới hai cửa sổ. Chấp nhận được với hạn mức chống lạm dụng; cửa sổ trượt tốn thêm bộ nhớ (sorted set) mà không cần thiết ở quy mô này.
- **Email không tồn tại cũng tạo key** (TTL tối đa 24 giờ). Spraying nhiều email thì tốn RAM Redis tỉ lệ theo số email, nhưng hạn mức theo IP chặn trước.
- **`TRUST_PROXY` phải khớp hạ tầng.** Đặt lớn hơn số proxy thật thì client tự ghi `X-Forwarded-For` là đổi được IP. Đặt nhỏ hơn thì mọi khách chung IP của proxy. Mỗi thay đổi hạ tầng (thêm CDN hoặc load balancer) phải xem lại biến này.
- **`promoOrder` đang áp cho mọi đơn**, kể cả đơn không khuyến mãi. Mặc định 5 đơn/phút/user nên khách thật không chạm. Khi có endpoint flash sale riêng thì chuyển decorator sang đó.

## Xử lý khi sự cố

- **Redis lỗi hoặc timeout** (`REDIS_COMMAND_TIMEOUT_MS`): rate limit và khoá đăng nhập tự cho qua. Log có `Rate limit storage unavailable…` hoặc `Login lockout … skipped…` (tối đa 1 dòng mỗi 10 giây mỗi loại). Redis hồi phục thì tự hoạt động lại, không cần khởi động lại API.
- **Mở khoá tay một tài khoản** (khách gọi hỗ trợ): `DEL auth:login:fail:<h> auth:login:strikes:<h> auth:login:lock:<h>` với `<h>` = sha256 của email đã chuẩn hoá (chữ thường, bỏ khoảng trắng). Hàm `loginAttemptKeys(email)` trả sẵn các key này; lệnh mẫu có trong README.
- **Khách thật bị 429 hàng loạt:** kiểm `TRUST_PROXY` trước. Nếu mọi request có cùng `req.ip` là IP của Nginx thì biến đang sai. Sau đó mới nâng hạn mức qua env `RATE_LIMIT_*` và khởi động lại.
- **Tắt khẩn cấp:** `RATE_LIMIT_ENABLED=false` tắt hạn mức request. Khoá đăng nhập vẫn chạy vì đó là kiểm soát an ninh; muốn nới thì tăng `LOGIN_MAX_FAILED_ATTEMPTS`.
- **Theo dõi:** số response 429 theo `code` (`TOO_MANY_REQUESTS`, `LOGIN_LOCKED`). Số `LOGIN_LOCKED` tăng vọt nghĩa là đang bị credential stuffing. Key `auth:login:lock:*` cho biết số tài khoản đang bị khoá.
