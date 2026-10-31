# ADR-0013: Triển khai production trên EC2: blue-green, HTTPS và secret từ SSM

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-31

## Bối cảnh

Production chạy trên một EC2 bằng Docker Compose. Yêu cầu:

- Chỉ Nginx mở 80/443; Postgres và Redis không phơi ra ngoài.
- HTTPS bằng Let's Encrypt, tự gia hạn.
- Deploy không gián đoạn: chạy song song màu mới, kiểm tra rồi mới chuyển traffic (đã chuẩn bị ở ADR-0010, ADR-0012).
- Không có file `.env` trên server, không có secret trong image, compose hay pipeline.

Các ràng buộc làm thiết kế không hiển nhiên:

- **Postgres/Redis cũng cần mật khẩu**, nhưng nằm trong mạng không có đường ra ngoài thì không gọi được SSM.
- **Biến do entrypoint export không có trong `docker exec` và healthcheck**, vì chúng là process riêng.
- **Hai màu cùng khởi động không được đua nhau chạy migration.**
- **Nginx không khởi động khi thiếu file cert**, còn Let's Encrypt lại cần Nginx phục vụ webroot.

## Lựa chọn

**Blue-green:**

- `api-blue`, `api-green` dùng chung image, DB, Redis và volume `invoices`; mỗi màu một compose profile.
- Upstream Nginx nằm ở `infra/nginx/upstream/active.conf`, chỉ có một server. `switch-upstream.sh` kiểm màu đích healthy, thay file nguyên tử, `nginx -t` rồi reload.
- Migration chạy một lần qua service `migrate`, trước khi bật màu mới. Image production không tự migrate.

**Secret:** tham số SSM SecureString theo đường dẫn `/shopfast/prod/<service>/<TÊN_BIẾN>`.

- **API:** `ssm-entrypoint.sh` đọc bằng IAM role của EC2 (qua IMDS), export vào process rồi `exec`. Secret chỉ nằm trong RAM.
- **Postgres/Redis:** sidecar `secrets-agent` đứng ở mạng có egress, ghi mật khẩu vào volume tmpfs riêng cho từng service. Hai service này giữ image chính thức, mạng `backend` là `internal: true`.

Phương án đã loại:

| Phương án                                 | Lý do loại                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Entrypoint SSM trong cả Postgres/Redis    | Hai service này phải có egress, mạng `backend` không thể `internal`         |
| Host đọc SSM rồi truyền qua `environment` | Secret nằm trong cấu hình container trên đĩa, `docker inspect` đọc được     |
| Docker secrets dạng file trên host        | Vẫn là file secret trên đĩa server                                          |
| `@aws-sdk/client-ssm` trong API           | Thêm dependency; Node không `exec` được nên vẫn cần shell và `eval` kết quả |
| Nhúng web vào image nginx                 | Cập nhật web phải tạo lại nginx, rớt WebSocket; chunk bản cũ biến mất       |

**HTTPS:** service `certbot` gia hạn mỗi 12 giờ qua webroot. `deploy-hook` chạm file đánh dấu, `watch-certs.sh` trong container nginx thấy thì reload. Lần đầu dùng `init-letsencrypt.sh`: cert tự ký tạm, bật Nginx, xin cert thật.

**Web:** container chạy một lần đổ file vào volume `web_static`, giữ file hash bản cũ 14 ngày.

## Lý do

- **`internal: true` là bảo vệ thật:** Postgres bị chiếm cũng không gửi được dữ liệu ra Internet. Chỉ "không publish cổng" thì không chặn được chiều ra.
- **tmpfs:** secret không chạm đĩa. `secrets-agent` chạy thường trực để volume không bị gỡ và để stack tự hồi phục sau reboot: Postgres/Redis lỗi thiếu file rồi được restart policy khởi động lại tới khi file có.
- **`server … resolve` trong upstream:** Nginx theo IP mới khi container khởi động lại, và không chết nếu màu đó chưa chạy.
- **Mount thư mục `upstream/`, không mount `active.conf`:** `mv` tạo inode mới; bind mount một file vẫn giữ inode cũ nên reload sẽ đọc bản cũ.
- **`export` không `eval`:** giá trị secret có `$` hoặc dấu nháy không bao giờ bị thực thi.
- **Không reload Nginx định kỳ:** reload giữ worker cũ tới khi WebSocket đóng, làm định kỳ sẽ tích worker và không cần thiết nếu cert không đổi.
- **Không cho certbot Docker socket:** socket tương đương root trên host.

## Đánh đổi

- **Image API lớn hơn** vì có `aws-cli` (kéo theo Python). Chấp nhận để dùng một script shell, không thêm dependency Node.
- **`prisma` chuyển sang `dependencies`** vì service `migrate` dùng chung image: image lớn hơn nhưng không phải quản lý image migrate riêng.
- **`docker exec` không có secret:** lệnh cần `DATABASE_URL` phải chạy bằng `docker compose run --rm migrate …` (đi qua entrypoint).
- **Khởi động phụ thuộc SSM:** SSM hoặc IMDS lỗi thì container mới không lên được. Container đang chạy không bị ảnh hưởng.
- **IMDS hop limit phải là 2** để container gọi được, nên mọi container trên máy dùng được role EC2. Giảm thiểu: role chỉ có quyền tối thiểu.
- **Role dùng chung cả máy:** chia đường dẫn SSM theo service chỉ để gọn, không phải ranh giới bảo mật.
- **Mật khẩu Postgres/Redis khai báo hai nơi:** tham số riêng và trong `DATABASE_URL`, `REDIS_URL`. Đổi mật khẩu phải sửa cả hai. Mật khẩu chỉ gồm `A-Za-z0-9_-` để khỏi phải escape.
- **Đổi secret cần khởi động lại container.** `POSTGRES_PASSWORD` chỉ có tác dụng khi khởi tạo DB; đổi trên DB đang chạy phải dùng `ALTER ROLE`.
- **Hai màu cùng chạy worker BullMQ trong lúc deploy:** an toàn vì job idempotent (ADR-0009); migration phải tương thích ngược (ADR-0001).
- **Một EC2 vẫn là điểm lỗi đơn.** Blue-green chống lỗi deploy, không chống hỏng máy.

## Xử lý khi sự cố

- **Container thoát với `ssm-entrypoint: không đọc được …`:** kiểm role EC2, `AWS_REGION`, hop limit (`aws ec2 describe-instances` → `HttpPutResponseHopLimit`).
- **`nginx` restart liên tục:** thường thiếu `upstream/active.conf` hoặc thiếu cert. Chạy `init-letsencrypt.sh`.
- **502 ở mọi request API:** màu trong `active.conf` không chạy. `docker compose ps`, rồi `switch-upstream.sh` sang màu đang healthy.
- **Màu mới lỗi sau khi chuyển:** `switch-upstream.sh <màu cũ>` (màu cũ còn chạy cho tới khi xác nhận xong), rồi dừng màu mới.
- **Migration lỗi:** không bật màu mới, màu cũ vẫn phục vụ. Xử lý theo ADR-0001.
- **Postgres/Redis restart liên tục sau reboot:** xem `docker compose logs secrets-agent`; thường do SSM chưa gọi được.
- **Cert sắp hết hạn:** `docker compose logs certbot`. Chạy tay `docker compose exec certbot certbot renew`; Nginx reload trong vòng 5 phút.
