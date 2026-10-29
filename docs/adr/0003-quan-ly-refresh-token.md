# ADR-0003: Quản lý refresh token (và thiết kế xác thực)

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-29

## Bối cảnh

ShopFast cần xác thực bằng token cho 4 vai trò (CUSTOMER, SUPPORT, WAREHOUSE, ADMIN) – F06. Yêu cầu liên quan:

- Access token ngắn hạn; refresh token **phải thu hồi được** (đăng xuất, nghi bị lộ, khoá tài khoản).
- F02: xác thực kết nối realtime tại bắt tay → cần kiểm token nhanh, không truy vấn DB mỗi lần.
- Bảo mật (SRS): không có giá trị nhạy cảm trong mã nguồn; hệ thống suy giảm có kiểm soát khi một thành phần phụ trợ (Redis) không sẵn sàng.
- Khách dùng nhiều thiết bị cùng lúc (điện thoại, laptop) – đăng xuất ở một nơi không được đá các nơi khác.

## Lựa chọn

| #   | Phương án                                                                                       | Thu hồi được?     | Ghi chú                                                        |
| --- | ----------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- |
| 1   | Chỉ một JWT dài hạn                                                                             | Không             | Lộ token = mất tài khoản tới khi hết hạn                       |
| 2   | Refresh token cũng là JWT, không lưu server                                                     | Chỉ với blacklist | Blacklist lại là trạng thái phía server, mất ưu điểm stateless |
| 3   | Refresh token đục lưu trong Redis                                                               | Có                | Redis sập / bị flush → mọi người bị đăng xuất; khó audit       |
| 4   | **Refresh token đục lưu PostgreSQL, xoay vòng mỗi lần dùng, phát hiện dùng lại theo family** ✅ | Có                | Chọn                                                           |

Thiết kế được chọn:

- **Access token:** JWT HS256, TTL `JWT_ACCESS_TTL` (mặc định 15 phút), payload chỉ `{ sub, role }`. Kiểm bằng chữ ký, không truy vấn DB.
- **Refresh token:** 32 byte ngẫu nhiên (`crypto.randomBytes`, base64url), TTL `REFRESH_TOKEN_TTL_DAYS` (7 ngày). Bảng `refresh_tokens` chỉ lưu **SHA-256** của token, kèm `family_id`, `expires_at`, `revoked_at`, `user_agent`, `ip`.
- **Family:** mỗi lần đăng nhập tạo một `family_id` mới (một thiết bị/phiên). Mọi token sinh ra khi refresh trong phiên đó dùng chung family.
- **Rotation:** `POST /auth/refresh` thu hồi token hiện tại và cấp token mới trong **một transaction**: `UPDATE … SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`. Chỉ khi cập nhật đúng 1 dòng mới tạo token mới.
- **Reuse detection:** nếu gửi lên một token **đã bị thu hồi** (hoặc thua trong cuộc đua hai request cùng refresh) → thu hồi **toàn bộ family**, trả `401 REFRESH_TOKEN_REUSED`, ghi log cảnh báo.
- **Đăng xuất:** `POST /auth/logout` thu hồi family của token (chỉ thiết bị đó). `POST /auth/logout-all` thu hồi mọi token của user.
- **Vai trò** đưa vào access token lấy từ DB tại thời điểm refresh → đổi quyền có hiệu lực chậm nhất sau một chu kỳ access token.
- **Guard mặc định từ chối:** `JwtAuthGuard` và `RolesGuard` đăng ký toàn cục; endpoint công khai phải ghi rõ `@Public()`, endpoint giới hạn vai trò dùng `@Roles(...)`.
- **Mật khẩu:** bcrypt (`bcryptjs`, thuần JS, không cần build native trong Alpine), cost `BCRYPT_ROUNDS` = 12. Đăng nhập với email không tồn tại vẫn so bcrypt với hash giả → thời gian phản hồi và thông điệp giống hệt sai mật khẩu, không dò được email.
- **OTP** (chuẩn bị cho rate limit ở F03): mã 6 số lưu Redis dạng hash, TTL 5 phút, tối đa 5 lần nhập sai, dùng một lần. Redis lỗi → chỉ OTP trả 503.

## Lý do

- **Thu hồi thật sự:** token nằm trong DB nên thu hồi là một câu `UPDATE`, có hiệu lực ngay ở lần refresh kế tiếp.
- **Lưu hash thay vì token gốc:** lộ bản sao lưu DB hoặc đọc trộm bảng không dùng được token. Token có 256 bit ngẫu nhiên nên SHA-256 là đủ (không cần bcrypt như mật khẩu), tra cứu bằng unique index.
- **Rotation + reuse detection** (theo khuyến nghị OAuth 2.0 Security BCP): refresh token bị đánh cắp chỉ dùng được cho tới khi chủ thật refresh lần tiếp theo; khi một trong hai bên dùng token cũ, cả phiên bị huỷ và chủ thật phải đăng nhập lại.
- **PostgreSQL thay vì Redis:** phiên đăng nhập là dữ liệu cần bền và audit được (ai, thiết bị nào, lúc nào). Redis chỉ dùng cho dữ liệu sống ngắn có thể mất (OTP, cache). Redis sập thì đăng nhập/refresh vẫn chạy – đúng yêu cầu suy giảm có kiểm soát.
- **Access token stateless:** guard kiểm chữ ký trong bộ nhớ, không tốn query; dùng lại được cho bắt tay WebSocket (F02) và giữ p95 thấp.
- **Family theo thiết bị:** đăng xuất một thiết bị không ảnh hưởng thiết bị khác.

## Đánh đổi

| Đánh đổi                                                                        | Giảm thiểu                                                                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Access token vẫn dùng được tới 15 phút sau khi đăng xuất/bị thu hồi             | TTL ngắn; nếu cần cắt ngay (khoá tài khoản) bổ sung denylist `jti` trong Redis có TTL bằng thời gian còn lại của token |
| Mỗi lần refresh tốn 1 SELECT + 1 transaction (UPDATE + INSERT)                  | Chỉ xảy ra ~15 phút/lần/thiết bị; có index unique trên `token_hash`                                                    |
| Hai tab cùng refresh một lúc → tab chậm hơn bị coi là dùng lại, cả phiên bị huỷ | Client gom refresh về một chỗ (một promise dùng chung); chấp nhận đánh đổi để ưu tiên an toàn                          |
| Bảng `refresh_tokens` lớn dần                                                   | Job dọn token hết hạn/đã thu hồi quá 30 ngày (F05)                                                                     |
| Refresh token gửi trong body JSON, client tự lưu → rủi ro XSS ở web             | Khi làm UI thật: chuyển refresh token sang cookie `HttpOnly; Secure; SameSite=Strict` chỉ cho path `/api/auth`         |
| HS256 dùng một secret chung                                                     | Chỉ API ký và kiểm; khi có dịch vụ khác cần kiểm token thì chuyển RS256/EdDSA                                          |
| Thay đổi vai trò có hiệu lực chậm tới 15 phút                                   | Kèm `logout-all` khi hạ quyền để buộc cấp token mới                                                                    |

## Xử lý khi sự cố

- **Nghi refresh token của một user bị lộ:** user (hoặc admin) gọi `POST /auth/logout-all` → mọi phiên bị thu hồi; reuse detection tự huỷ phiên nếu kẻ gian dùng token cũ. Log `Refresh token reuse detected` là tín hiệu cần theo dõi/cảnh báo.
- **Lộ `JWT_SECRET`:** sinh secret mới (`openssl rand -hex 32`), cập nhật biến môi trường và triển khai lại → mọi access token cũ mất hiệu lực ngay. Đồng thời thu hồi toàn bộ refresh token (`UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL`) nếu nghi DB cũng bị lộ.
- **PostgreSQL không sẵn sàng:** đăng nhập/refresh trả 5xx tiếng Việt; access token đang có vẫn được kiểm (không cần DB) nên các endpoint đọc có cache vẫn phục vụ được tới khi token hết hạn.
- **Redis không sẵn sàng:** xác thực không bị ảnh hưởng; chỉ `/auth/otp/*` trả `503 SERVICE_UNAVAILABLE` ngay lập tức (client Redis tắt hàng đợi offline nên không treo request).
- **User bị khoá/xoá:** `logout-all` cho user đó; `/auth/me` trả 401 khi user không còn tồn tại. Access token còn lại hết hạn trong tối đa 15 phút.
- **Brute force mật khẩu / spam OTP:** endpoint `login` và `otp/send` đã được đánh dấu để gắn rate limit theo tài khoản và IP ở F03; OTP tự khoá sau 5 lần nhập sai.
