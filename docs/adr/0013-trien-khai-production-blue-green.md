# ADR-0013: Triển khai production trên một EC2: blue-green và HTTPS

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-31
- **Cập nhật:** build và CD thay bằng [ADR-0014](0014-cd-ec2-tu-keo-ban-moi.md), trình tự deploy và rollback ở [ADR-0015](0015-zero-downtime-va-gioi-han.md). Phần blue-green, secret, HTTPS, mạng vẫn có hiệu lực.

## Bối cảnh

Production chạy trên một EC2 bằng Docker Compose, không phụ thuộc dịch vụ AWS nào khác (đồ án, ưu tiên đơn giản và chi phí thấp). Yêu cầu:

- Chỉ Nginx mở 80/443; Postgres và Redis không phơi ra ngoài.
- HTTPS bằng Let's Encrypt, tự gia hạn.
- Deploy không gián đoạn: chạy song song màu mới, kiểm tra rồi mới chuyển traffic (đã chuẩn bị ở ADR-0010, ADR-0012).
- Không có secret trong git, image hay Dockerfile.

Hai điểm làm thiết kế không hiển nhiên:

- **Hai màu cùng khởi động không được đua nhau chạy migration.**
- **Nginx không khởi động khi thiếu file cert**, còn Let's Encrypt lại cần Nginx phục vụ webroot.

## Lựa chọn

**Blue-green:**

- `api-blue`, `api-green` dùng chung DB, Redis và volume `invoices`; mỗi màu một compose profile.
- Upstream Nginx nằm ở `infra/nginx/upstream/active.conf`, chỉ có một server.
- `infra/scripts/deploy.sh` làm trọn một lần deploy: build image trên máy, migrate, đổ web, bật màu còn lại, chờ healthy, `switch-upstream.sh`, dừng màu cũ. Màu mới không healthy sau 2 phút thì dừng màu mới, traffic giữ nguyên.

**Secret:** một file `infra/.env` trên server, `chmod 600`, sinh ngẫu nhiên bằng `init-env.sh`, nằm trong `.gitignore`. Compose tự đọc file này.

Phương án đã loại:

| Phương án                         | Lý do loại                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------- |
| AWS SSM Parameter Store + sidecar | Thêm IAM, IMDS hop limit và một service thường trực; quá nặng so với nhu cầu |
| Registry (ECR) + build ở CI       | Thêm dịch vụ và pipeline; một máy thì build tại chỗ là đủ                    |
| Nhúng web vào image nginx         | Cập nhật web phải tạo lại nginx, rớt WebSocket; chunk bản cũ biến mất        |

**HTTPS:** service `certbot` gia hạn mỗi 12 giờ qua webroot. `deploy-hook` chạm file đánh dấu, `watch-certs.sh` trong container nginx thấy thì reload. Lần đầu dùng `init-letsencrypt.sh`: cert tự ký tạm, bật Nginx, xin cert thật.

**Web:** container chạy một lần đổ file vào volume `web_static`, giữ file hash bản cũ 14 ngày.

## Lý do

- **`internal: true` cho mạng `backend`:** Postgres bị chiếm cũng không gửi được dữ liệu ra Internet. Chỉ "không publish cổng" thì không chặn được chiều ra.
- **`server … resolve` trong upstream:** Nginx theo IP mới khi container khởi động lại, và không chết nếu màu đó chưa chạy.
- **Mount thư mục `upstream/`, không mount `active.conf`:** `mv` tạo inode mới; bind mount một file vẫn giữ inode cũ nên reload sẽ đọc bản cũ.
- **Migration là bước riêng:** chạy đúng một lần, lỗi thì dừng deploy khi màu cũ vẫn phục vụ.
- **Không reload Nginx định kỳ:** reload giữ worker cũ tới khi WebSocket đóng, làm định kỳ sẽ tích worker và không cần thiết nếu cert không đổi.
- **Không cho certbot Docker socket:** socket tương đương root trên host.

## Đánh đổi

- **Secret ở dạng rõ trên đĩa EC2**, và `docker inspect` đọc được. Ai có SSH vào máy là đọc được. Giảm thiểu: cổng 22 chỉ mở cho IP quản trị, file `chmod 600`.
- **Mất EC2 là mất `infra/.env`.** Phải lưu một bản ở nơi an toàn, nếu không sẽ mất mật khẩu DB và `JWT_SECRET`.
- **Build trên máy đang phục vụ khách:** tốn CPU/RAM vài phút mỗi lần deploy; EC2 cần ít nhất 4 GB RAM kể cả swap.
- **`prisma` nằm ở `dependencies`** vì service `migrate` dùng chung image.
- **Hai màu cùng chạy worker BullMQ trong lúc deploy:** an toàn vì job idempotent (ADR-0009); migration phải tương thích ngược (ADR-0001).
- **Đổi secret cần tạo lại container.** Mật khẩu Postgres chỉ có tác dụng khi khởi tạo DB; đổi trên DB đang chạy phải dùng `ALTER ROLE`.
- **Một EC2 là điểm lỗi đơn.** Blue-green chống lỗi deploy, không chống hỏng máy.

## Xử lý khi sự cố

- **`deploy.sh` báo màu mới không healthy:** traffic vẫn ở màu cũ. Đọc log script in ra, sửa rồi deploy lại.
- **Rollback sau khi đã deploy:** `infra/scripts/rollback.sh` (ADR-0015). Migration không tự quay lui (ADR-0001).
- **`nginx` restart liên tục:** thường thiếu `upstream/active.conf` hoặc thiếu cert. Chạy `init-letsencrypt.sh`.
- **502 ở mọi request API:** màu trong `active.conf` không chạy. `docker compose ps`, rồi `switch-upstream.sh` sang màu đang healthy.
- **Migration lỗi:** `deploy.sh` dừng trước khi bật màu mới, màu cũ vẫn phục vụ. Xử lý theo ADR-0001.
- **Cert sắp hết hạn:** `docker compose logs certbot`. Chạy tay `docker compose exec certbot certbot renew`; Nginx reload trong vòng 5 phút.
