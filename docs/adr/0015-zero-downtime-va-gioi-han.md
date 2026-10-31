# ADR-0015: Chiến lược zero-downtime và các giới hạn

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-31

## Bối cảnh

ADR-0013 đã có blue-green trên một EC2, nhưng còn thiếu:

- Không kiểm tra sau khi đổi traffic: lỗi chỉ lộ ra ở đường đi thật thì vẫn lên production.
- Dừng màu cũ ngay sau khi đổi, không có thời gian drain.
- Rollback phải build lại, mất nhiều phút.

Mục tiêu: pipeline dưới 10 phút, rollback dưới 2 phút, deploy lỗi không ảnh hưởng khách.

## Lựa chọn

`deploy.sh <sha>` theo thứ tự:

1. Kiểm tra image có trên máy, khoá `flock` chống chạy chồng.
2. Có migration mới so với `last_good_sha` thì `backup.sh` trước, rồi `migrate`.
3. Bật màu còn lại, chờ healthcheck Docker tối đa 2 phút.
4. `switch-upstream.sh`: `nginx -t`, đổi `active.conf`, `nginx -s reload`.
5. Kiểm tra qua đúng đường của khách (`https://$DOMAIN` qua Nginx): `/health` đạt và `/health/live` báo đúng commit, 5 lần liên tiếp.
6. Drain 30 giây (`DRAIN_SECONDS`), dừng màu cũ (SIGTERM, tắt êm theo ADR-0012).
7. Ghi `.deploy/last_good_sha` và `deploy_history`, giữ 5 image gần nhất.

Hỏng ở bước 2–4: màu cũ không bị đụng tới, exit 1. Hỏng ở bước 5: tự gọi `rollback.sh`, exit 1. Workflow báo fail khi `/health/live` không báo đúng SHA sau 5 phút (ADR-0014).

`rollback.sh [sha]`: màu cũ còn chạy đúng SHA thì chỉ đổi upstream; không thì bật lại từ image có sẵn. Không build, không migrate.

## Lý do

- **Kiểm tra qua Nginx, không chỉ container:** healthcheck Docker không phát hiện được upstream, TLS hay cấu hình Nginx sai.
- **So commit:** `/health` đạt chưa chứng minh traffic đã tới bản mới.
- **Giữ màu cũ tới khi kiểm tra xong:** rollback lúc đó chỉ là đổi upstream, tính bằng giây.
- **Giữ image trên máy:** rollback không phụ thuộc mạng hay GitHub.
- **Reload Nginx thay vì restart:** worker cũ phục vụ nốt request đang chạy.

## Đánh đổi

Đây là zero-downtime cho request HTTP, không phải cho mọi thứ:

- **WebSocket bị ngắt** khi màu cũ dừng; client tự nối lại và vào lại room (ADR-0010). Sự kiện phát trong lúc đang ngắt không được gửi lại; client đọc lại trạng thái đơn khi nối lại.
- **Migration phải expand-contract:** hai bản dùng chung một DB, nên bản mới không được xoá hay đổi tên cột bản cũ đang dùng. Bỏ cột phải chờ một lần deploy sau.
- **Rollback không quay lui schema.** Migration đã áp dụng vẫn còn; đây là lý do phải tương thích ngược, và bản backup trước migrate là đường lui cuối cùng.
- **Hai màu cùng chạy worker BullMQ trong lúc chồng lấn:** an toàn nhờ job idempotent (ADR-0009). Job chạy lâu hơn `SHUTDOWN_TIMEOUT_MS` sẽ chạy lại.
- **Rate limit, cache, phiên** nằm ở Redis dùng chung nên không mất; nhưng Redis có thể chứa cache theo định dạng mới khi rollback. Cache có version và TTL ngắn (ADR-0007).
- **Rollback web:** tab đang mở vẫn dùng bản JS đã tải tới khi tải lại; file hash cũ giữ 14 ngày nên không lỗi.
- **`rollback.sh` dùng compose hiện có trên server**, không checkout commit cũ. Bản đích cần biến môi trường hoặc service khác thì phải sửa tay.
- **Một EC2 vẫn là điểm lỗi đơn.** Máy chết thì mất dịch vụ tới khi dựng lại từ backup (`docs/restore-drill.md`). Nâng cấp máy, reboot và đổi Postgres/Redis cũng có gián đoạn.
- **Đổi file trong `infra/nginx/` không tự có hiệu lực:** các file mount lẻ giữ inode cũ, phải `docker compose restart nginx` sau deploy và chấp nhận rớt kết nối vài giây.
- **Lúc chồng lấn cần gấp đôi RAM API.** Máy 2 GB dựa vào swap; quan sát `free -h` khi deploy.

## Xử lý khi sự cố

- **Workflow báo fail, site vẫn chạy:** đọc log job hoặc `infra/.deploy/deploy.log`. Traffic ở bản cũ, sửa rồi push lại.
- **Lỗi nghiệp vụ phát hiện sau khi deploy xong:** `./infra/scripts/rollback.sh`, không truyền đối số sẽ về bản tốt liền trước.
- **`rollback.sh` báo thiếu image:** bản đó đã bị dọn, chỉ giữ 5 bản. Dùng `git checkout <sha>` rồi `deploy.sh` để build tại chỗ.
- **`Đang có deploy hoặc rollback khác chạy`:** chờ xong. Không xoá file khoá; khoá `flock` tự nhả khi tiến trình kết thúc.
- **Migration lỗi:** màu cũ vẫn phục vụ. Xử lý theo ADR-0001.
