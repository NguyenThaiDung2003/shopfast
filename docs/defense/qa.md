# 20 câu hội đồng có thể hỏi

Đường dẫn mã tính từ `apps/api/src/`, trừ khi ghi khác.

## Sự cố

### 1. Redis chết thì sao?

Redis là lớp tăng tốc, không phải nguồn dữ liệu. `/health` trả 200 `degraded`, chỉ DB lỗi mới 503 (`modules/health/health.service.ts`).

- Cache: log cảnh báo rồi đọc DB (`modules/cache/cache.service.ts:195`).
- Rate limit: cho qua (`modules/rate-limit/redis-throttler.storage.ts:62-65`). Đây là fail-open có chủ đích: chặn khách vì Redis lỗi tệ hơn.
- OTP: trả 503 tiếng Việt vì không có nơi lưu mã.
- Realtime giữa các instance và job BullMQ dừng tới khi Redis hồi phục.

Tồn kho không nằm ở Redis nên đặt đơn vẫn đúng.

### 2. Deploy lỗi thì sao?

Tuỳ thời điểm (`infra/scripts/deploy.sh`):

- Migration lỗi: dừng, màu cũ chưa bị đụng tới.
- Màu mới không healthy sau 2 phút: dừng màu mới, exit 1.
- Sau khi đổi traffic mà `/health/live` qua Nginx sai commit: tự chạy `rollback.sh`, exit 1.

Mã thoát SSH làm workflow báo đỏ. `last_good_sha` chỉ ghi khi đã đạt hết.

### 3. Hai người mua món cuối cùng?

Không đọc rồi ghi. Một câu `UPDATE products SET stock = stock - qty WHERE id = ? AND stock >= qty` (`modules/orders/orders.repository.ts:153-154`). Postgres khoá dòng nên người thứ hai chờ, rồi thấy `stock` đã 0, số dòng ảnh hưởng là 0. Transaction rollback, repository trả union `insufficient_stock`, service đổi thành 409.

### 4. Đơn nhiều sản phẩm có deadlock không?

Không theo thứ tự thì có: A khoá 1 chờ 2, B khoá 2 chờ 1. Ở đây các dòng được sắp theo `productId` trước khi trừ (`orders.repository.ts:128`), nên mọi transaction khoá cùng một thứ tự.

### 5. Job chạy lại có gửi email hai lần không?

Không. `deliverOnce` giành quyền trong `email_deliveries` trước khi gửi (`modules/jobs/email-jobs.service.ts:99`). `jobId` cố định `<loại>-<orderId>` chặn đẩy trùng (`modules/jobs/queues.ts:72`). Worker đọc lại DB và kiểm lại trạng thái khi chạy, vì payload chỉ mang id.

Giới hạn: nếu worker chết đúng sau khi SMTP nhận thư mà trước khi ghi kết quả, không có cơ chế nào đạt exactly-once tuyệt đối với SMTP.

### 6. Lộ access token thì sao?

Access token sống ngắn, không thu hồi được từng cái, đó là đánh đổi của JWT. Giảm thiệt hại bằng thời hạn ngắn. Nghi lộ thì thu hồi refresh token của user (`modules/auth/token.service.ts:101`) để không gia hạn được; muốn vô hiệu toàn bộ ngay thì đổi `JWT_SECRET`, mọi người phải đăng nhập lại.

### 7. Lộ refresh token thì sao?

Refresh token xoay vòng, dùng một lần. Token đã thu hồi mà bị dùng lại là dấu hiệu bị đánh cắp: hệ thống thu hồi cả family (`token.service.ts:78-79`, `:89`). Trong DB chỉ lưu dạng băm ([ADR-0003](../adr/0003-quan-ly-refresh-token.md)).

### 8. EC2 chết thì sao?

Dịch vụ dừng; đây là giới hạn đã chấp nhận: một EC2 là điểm lỗi đơn. Khôi phục theo `docs/restore-drill.md`: dựng máy mới, khôi phục `infra/.env`, `pg_restore` bản mới nhất từ S3, deploy, trỏ Elastic IP. Mất tối đa dữ liệu 24 giờ (RPO), hoá đơn PDF không nằm trong dump.

### 9. Backup có chắc khôi phục được không?

`backup.sh` kiểm file bằng `pg_restore --list` trước khi upload. `restore.sh` khôi phục thật vào DB mới và đối chiếu số dòng. Trích kết quả từ biên bản đã điền trong `docs/restore-drill.md`, nói đúng số đo thật.

### 10. Lộ `DEPLOY_SSH_KEY` thì sao?

Key chỉ chạy được `shopfast-ci-entry` (`restrict,command=`), không có shell, và cổng 22 đóng với IP lạ. Nhưng `load-images` nạp được image tuỳ ý, nên coi như secret production. Xử lý: xoá dòng trong `authorized_keys`, xoá Secret, tạo key mới.

## Quyết định kỹ thuật

### 11. Vì sao không dùng ECR và SSM như yêu cầu ban đầu?

Một máy thì image nằm ngay trên máy là đủ, và rollback không phụ thuộc mạng. Giữ được mục tiêu: không access key dài hạn (OIDC), cổng 22 không thường trực, build ngoài server. Đánh đổi: còn một SSH key trong GitHub Secrets ([ADR-0014](../adr/0014-oidc-va-cong-ssh-tam-thoi.md)). Nếu lên nhiều máy, ECR và SSM sẽ đáng dùng.

### 12. OIDC an toàn hơn access key thế nào?

Không có khoá lưu ở GitHub. Mỗi lần chạy, GitHub cấp token có `sub` ghi rõ repo và nhánh; AWS đối chiếu rồi cấp credential tạm. Trust policy khớp chính xác `repo:NguyenThaiDung2003/shopfast:ref:refs/heads/main`, nên fork hay nhánh khác không lấy được quyền.

### 13. Zero-downtime thật sự tới mức nào?

Với HTTP: `nginx -s reload` để worker cũ làm nốt request, màu cũ drain 30 giây rồi nhận SIGTERM và tắt êm. Với WebSocket: có ngắt, client tự nối lại và ack subscribe trả trạng thái mới nhất (`apps/web/src/realtime/order-socket.ts:107`). Số đo thật trên server: 265 request trong một lần deploy và 578 request qua các lần ép lỗi và rollback, tất cả trả 200; rollback mất 12–24 giây. Giới hạn ở [ADR-0015](../adr/0015-zero-downtime-va-gioi-han.md).

### 14. Migration thế nào để không gãy khi hai bản cùng chạy?

Theo expand-contract: thêm cột trước, bản mới dùng, lần sau mới xoá. Migration chạy một lần ở service `migrate`, trước khi bật màu mới, có backup trước nếu có migration mới. Rollback không quay lui schema, nên tương thích ngược là bắt buộc.

### 15. Vì sao emit sự kiện sau commit?

Phát trong transaction mà rollback thì khách nhận thông báo về thay đổi không tồn tại. Listener lỗi không làm hỏng request gốc. Đánh đổi: tiến trình chết đúng lúc giữa commit và emit thì mất sự kiện, vì không có outbox. Trạng thái đơn trong DB vẫn đúng ([ADR-0004](../adr/0004-domain-event-noi-bo.md)).

### 16. Cache sai giá thì sao?

Mọi thay đổi giá, ảnh, tồn kho phát `product.updated`, `CatalogCacheListener` vô hiệu hoá cache đồng bộ trước khi trả response (`modules/catalog/catalog-cache.listener.ts:16-18`). Khoá có version nên cache cũ tự bị bỏ qua, có TTL jitter. Sửa SQL tay phải tự xoá cache. Module đơn hàng và giỏ hàng không dùng `CatalogCacheService`, giá khi đặt đơn lấy từ DB ([ADR-0007](../adr/0007-cache-catalog-redis.md)).

### 17. Vì sao đếm đăng nhập sai theo email, không theo IP?

Theo IP thì kẻ tấn công đổi IP là qua, và người dùng chung IP công ty bị khoá oan. Có hai lớp: rate limit theo IP (10/60 giây) và khoá theo email (5 lần), kiểm trước bcrypt nên không tốn CPU. Đánh đổi: kẻ xấu có thể cố ý khoá tài khoản người khác trong thời gian ngắn ([ADR-0008](../adr/0008-rate-limit-va-khoa-dang-nhap.md)).

### 18. Prompt injection qua nội dung ticket thì sao?

Nội dung khách đặt trong thẻ và ghi rõ là dữ liệu. Quan trọng hơn: dù model bị dẫn dắt, nó không có tool ghi. Tool `proposeCancelOrder`, `proposeReturnRequest` chỉ tạo `PendingAction`, nhân viên phải bấm xác nhận. Tool dùng service nghiệp vụ nên chịu cùng luật quyền như HTTP. Câu trả lời cuối qua `parseFinalAnswer` và grounding: mã đơn, SKU, trạng thái, tồn kho phải có trong kết quả tool ([ADR-0011](../adr/0011-ai-agent-human-in-the-loop.md)).

### 19. Hai nhân viên cùng xác nhận một đề xuất?

Compare-and-set `PENDING → EXECUTING` trong `modules/support/pending-actions.repository.ts:115-122`: `updateMany` với điều kiện trạng thái, chỉ một người được 1 dòng. Điều kiện được kiểm lại lúc xác nhận vì trạng thái đơn có thể đã đổi. Cùng mẫu với `orders.status` (`orders.repository.ts:226-227`).

### 20. Vì sao chọn modular monolith, không microservices?

Một người, một máy, nghiệp vụ gắn chặt qua transaction đặt đơn. Tách service sẽ thêm giao dịch phân tán mà không có lợi ích tương xứng. Ranh giới module, domain event và queue đã rõ, nên sau này có thể tách worker hoặc realtime ra tiến trình riêng. Muốn scale ngang: thêm instance API đã được hỗ trợ nhờ state ở Redis/Postgres, Redis adapter và job idempotent.

## Cách trả lời khi chưa chắc

Nói rõ phần đã kiểm chứng và phần chưa làm. Ví dụ: "Chưa có outbox nên kịch bản đó có thể mất sự kiện; tôi đã chấp nhận vì trạng thái trong DB vẫn đúng". Hội đồng đánh giá cao việc biết giới hạn của mình.
