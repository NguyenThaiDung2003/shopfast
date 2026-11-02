# ADR-0017: Đăng ký, xác minh email và quên mật khẩu bằng OTP

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-11-02

## Bối cảnh

Web chưa có trang đăng ký. OTP chỉ ghi log, xác minh xong không lưu gì, nên ai cũng đăng ký được bằng email người khác. Chưa có cách lấy lại mật khẩu. Hệ thống đã có SMTP thật (ADR-0009).

## Lựa chọn

- **Đăng ký:** tạo user với `email_verified_at = NULL`, gửi OTP, không cấp token. Chỉ `POST /auth/register` ghi NULL; cột mặc định `now()` nên user cũ, seed và nhân viên coi như đã xác minh.
- **Đăng nhập:** đúng mật khẩu nhưng chưa xác minh → 403 `EMAIL_NOT_VERIFIED`. Kiểm sau mật khẩu để người lạ không biết trạng thái tài khoản.
- **Quên mật khẩu:** `POST /auth/password/reset` nhận email, mã và mật khẩu mới trong một request. Thành công thì đánh dấu đã xác minh, thu hồi mọi refresh token, xoá khoá đăng nhập.
- **Gửi OTP:** `POST /auth/otp/send` luôn trả 202 và luôn lưu hash. Thư chỉ gửi cho tài khoản đủ điều kiện, mỗi email 30 giây một lần. `OtpSender` gửi thẳng qua `MailSender`, không chờ SMTP.

Không dùng link xác minh vì đã có sẵn OTP và trang nhập mã. Không giữ đăng ký tạm trong Redis vì Redis chỉ là lớp tăng tốc.

## Lý do

- Phản hồi và thời gian như nhau nên không dò được email nào có tài khoản; đó là lý do không chờ SMTP.
- Chỉ gửi cho tài khoản có thật nên API không bị dùng để gửi thư rác tới địa chỉ lạ.
- OTP là **ngoại lệ** của quy tắc email qua `deliverOnce` và queue: payload job hiện trên Bull Board nên sẽ làm lộ mã, lưu mã thô cũng phá việc chỉ giữ hash. Mỗi mã chỉ gửi một lần, gửi hỏng thì người dùng bấm gửi lại nên không cần claim hay retry.
- Khoá Redis dùng sha256(email), cùng cách với ADR-0008.

## Đánh đổi

- `POST /auth/register` đổi hợp đồng, không còn trả token.
- `POST /auth/otp/send` trả 202 dù SMTP lỗi; người dùng chỉ thấy không nhận được thư. Lỗi nằm ở log `OTP mail failed`.
- Tiến trình chết đúng lúc gửi thì mất thư, người dùng bấm gửi lại sau 30 giây.
- Email đã đăng ký vẫn trả 409 nên trang đăng ký dò được email. Rate limit `register` giới hạn việc này; dùng thông báo chung sẽ khiến khách không biết mình đã có tài khoản.
- Đăng ký hộ bằng email người khác làm chủ email gặp 409. Chủ email dùng quên mật khẩu để lấy lại, mật khẩu của người đăng ký hộ mất tác dụng.
- `MAIL_REDIRECT_TO` (demo) gom cả OTP về một hộp thư. Muốn khách thật tự đăng ký được thì phải bỏ biến này.

## Xử lý khi sự cố

- **SMTP lỗi:** tìm `OTP mail failed` trong log API, sửa SMTP, người dùng bấm gửi lại. Đăng ký vẫn tạo tài khoản.
- **Redis lỗi:** gửi và nhập mã trả 503 tiếng Việt. Đăng ký vẫn tạo tài khoản, trả `expiresInSeconds: 0`, web mời gửi lại.
- **Rollback về bản trước ADR này:** bản cũ không kiểm cột mới nên tài khoản chưa xác minh đăng nhập được tới khi deploy lại.
- **Cần kích hoạt tay:** `UPDATE users SET email_verified_at = now() WHERE email = '...' AND email_verified_at IS NULL;`
