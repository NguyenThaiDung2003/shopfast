# ADR-0009: Background jobs bằng BullMQ (email, hoá đơn, đồng bộ tồn kho)

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-30

## Bối cảnh

F05: sau khi đặt đơn hoặc đổi trạng thái đơn có nhiều việc chậm hoặc không tin cậy:

- gửi email xác nhận qua SMTP;
- xuất hoá đơn PDF;
- gọi API đồng bộ tồn kho của đối tác (hay lỗi tạm thời);
- nhắc thanh toán sau 30 phút;
- gửi báo cáo doanh thu cho admin lúc 0h hằng ngày.

Ràng buộc:

- **API trả về ngay**, không chờ các việc trên. SMTP hay đối tác chậm hoặc lỗi không được làm hỏng `POST /orders`.
- **Lỗi tạm thời phải tự thử lại** có giãn cách. Lỗi mãi không hết phải được giữ lại kèm lý do để người vận hành xử lý, không âm thầm biến mất.
- **Chạy lại job không được gửi email lần hai.** Job có thể chạy lại vì retry, vì event phát trùng, vì admin bấm retry trên Bull Board, hoặc vì worker chết giữa chừng.
- API chạy nhiều instance: lịch 0h chỉ được chạy **một lần**, không phải mỗi instance một lần.
- Event `order.created` / `order.status_changed` đã phát sau commit (ADR-0004, ADR-0006). Listener chạy trong process, không có retry.

## Lựa chọn

**BullMQ** (`@nestjs/bullmq`) trên Redis đã có (`modules/jobs/`).

**Queue và cấu hình.** Có 4 queue có worker, cộng một queue `dead-letter`. Backoff đều là exponential, mức chờ = `QUEUE_BACKOFF_BASE_MS` (mặc định 2s) × hệ số × 2^(lần thử − 1).

| Queue             | Job                                                              | attempts | Hệ số backoff |
| ----------------- | ---------------------------------------------------------------- | -------: | ------------: |
| `email`           | `order-confirmation`, `payment-reminder`, `daily-revenue-report` |        5 |             1 |
| `invoice`         | `invoice` (khi đơn → PAID)                                       |        3 |             2 |
| `inventory-sync`  | `inventory-reserve` (đặt đơn), `inventory-release` (huỷ đơn)     |        6 |           0,5 |
| `ticket-classify` | `ticket-classify` (ticket mới, F06, ADR-0011)                    |        4 |             2 |
| `dead-letter`     | bản sao job hết lượt thử; không có worker                        |        – |             – |

**Đẩy job.** `OrderJobsListener` nghe `order.created` / `order.status_changed` với `async: true` theo ADR-0004, rồi gọi `OrderJobsService`. Cách ánh xạ:

- `order.created` → email xác nhận, `inventory-reserve`, và nhắc thanh toán (delayed 30 phút).
- `order.status_changed` sang PAID → hoá đơn và gỡ job nhắc thanh toán.
- `order.status_changed` sang CANCELLED → `inventory-release` và gỡ job nhắc thanh toán.

Payload chỉ chứa `orderId` và `code`; worker tự đọc dữ liệu mới nhất từ DB khi chạy.

**Idempotent, gồm hai lớp:**

1. **jobId cố định** `<loại job>-<orderId>`, ví dụ `order-confirmation-<uuid>`. BullMQ cấm dấu `:` trong id. Đẩy lại cùng jobId trong lúc job cũ còn lưu trong Redis thì BullMQ bỏ qua.
2. **Bảng `email_deliveries`**, unique `(kind, ref)`. `ref` là orderId, hoặc `<ngày>:<adminId>` với báo cáo.
   - Trước khi gửi, worker **giành quyền** bằng một câu `INSERT … ON CONFLICT DO UPDATE … WHERE status = 'SENDING' AND claimed_at < now() − 10 phút RETURNING id`.
   - Giành được → gửi → `SENT`. Không giành được → bỏ qua, job hoàn tất với `skipped: already_sent`.
   - Gửi lỗi → xoá dòng giành quyền rồi ném lỗi để BullMQ thử lại.
   - `Message-ID` cố định `<loại.ref@shopfast.local>`.

**Dead-letter tự làm.** BullMQ không có dead-letter queue sẵn.

- Sự kiện `failed` của worker phát **sau mỗi lần thử lỗi**. `DeadLetterService` chỉ chép job sang `dead-letter` khi `attemptsMade ≥ attempts`, hoặc khi lỗi là `UnrecoverableError` (ví dụ đơn không tồn tại: thử lại cũng vô ích).
- Bản sao gồm queue, tên job, jobId, data gốc, `failedReason`, `stacktrace`, `attemptsMade`, `failedAt`. Bản sao có jobId `<queue>-<jobId gốc>` nên không bị chép trùng.

**Worker kiểm lại khi chạy.**

- Nhắc thanh toán chỉ gửi nếu đơn **vẫn** `PENDING_PAYMENT`. Gỡ job hẹn giờ khi đơn PAID/CANCELLED chỉ là tối ưu: gỡ không kịp thì worker tự bỏ qua.
- Hoá đơn chỉ xuất cho đơn đã PAID hoặc ở bước sau. File được ghi qua file tạm rồi `rename` nên nguyên tử, chạy lại chỉ ghi đè đúng `<mã đơn>.pdf`. Font DejaVu được nhúng, vì Helvetica mặc định của PDFKit không có chữ tiếng Việt có dấu.

**Lịch.** Delayed job cho nhắc thanh toán (`PAYMENT_REMINDER_DELAY_MS`). Báo cáo doanh thu dùng `upsertJobScheduler('daily-revenue-report', { pattern: '0 0 * * *', tz: REPORT_TIMEZONE })`.

- Scheduler nằm trong Redis theo id cố định, nên nhiều instance cùng upsert vẫn chỉ có một lịch.
- "Doanh thu ngày D" = tổng tiền các đơn có `paidAt` trong [00:00, 24:00) ngày D theo giờ VN, trừ đơn đã huỷ. Báo cáo gửi cho từng admin, mỗi người một dòng trong `email_deliveries`.

**Kết nối Redis riêng cho BullMQ** (`queue-connection.ts`), không dùng `REDIS_CLIENT`:

- Worker bắt buộc `maxRetriesPerRequest: null`, trái với client fail-fast của cache và rate limit.
- `@nestjs/bullmq` tạo Worker bằng chính cấu hình kết nối của queue, nên producer không có kết nối fail-fast riêng.
- Thay vào đó, listener giới hạn mỗi lần `add()` trong 2 giây rồi log lỗi.

**Tách vai trò bằng env.** Processor để `autorun: false`; `WorkersBootstrapService` chỉ chạy worker và đăng ký lịch khi `QUEUE_WORKERS_ENABLED=true`. Instance tắt cờ này vẫn đẩy job.

**Gửi email** qua cổng `MailSender`. Bản `SmtpMailSender` dùng nodemailer, cấu hình bằng `SMTP_*`. Dev dùng **Mailpit** trong compose; test thay bằng bản ghi lại thư.

**Đối tác giả lập.** `FakePartnerInventoryClient` có độ trễ và lỗi ngẫu nhiên theo `PARTNER_FAILURE_RATE` (mặc định 30%) để demo retry, và nhận jobId làm khoá chống trùng.

**Bull Board** tại `/admin/queues`, ngoài prefix `/api`.

- Middleware tự kiểm access token (header Bearer, hoặc cookie `sf_admin_queues`) bằng `TokenService.verifyAccessToken` và yêu cầu vai trò ADMIN.
- Cookie được đặt qua `POST /api/admin/queues/session`: httpOnly, `SameSite=Strict`, `Path=/admin/queues`, hết hạn cùng access token.
- `GET /api/admin/queues/stats` trả số job waiting/active/delayed/completed/failed của từng queue.

Phương án đã loại:

- **Gửi email ngay trong listener:** không có retry; process chết là mất việc; SMTP chậm làm event loop phải giữ hàng trăm kết nối.
- **Cron trong process (`@nestjs/schedule`):** mỗi instance chạy một lần, cần thêm khoá phân tán; không có retry và không xem được trên dashboard.
- **RabbitMQ hoặc SQS:** thêm hạ tầng mới, trong khi Redis đã có. BullMQ có sẵn delay, repeat, backoff và UI.
- **Chỉ dựa vào jobId để chống gửi trùng:** jobId chỉ chặn khi job cũ **còn trong Redis**. Job hoàn tất bị dọn sau 7 ngày, admin có thể retry tay, và retry sau khi SMTP đã nhận thư cũng gửi lại. Bảng có unique constraint mới là bảo đảm bền.
- **Ghi `SENT` sau khi gửi, không giành quyền trước:** hai worker chạy cùng lúc (hiếm, nhưng xảy ra khi stalled job bị chạy lại) sẽ cùng gửi.

## Lý do

- **Tách việc chậm khỏi request:** listener chỉ ghi một job vào Redis (vài ms) rồi xong. Phần chậm chạy trong worker có retry, concurrency và giới hạn riêng.
- **Hai lớp idempotent bổ sung cho nhau:** jobId rẻ, chặn phần lớn trường hợp trùng ngay tại Redis. Bảng `email_deliveries` chặn phần còn lại và giữ lịch sử đã gửi cho ai, khi nào.
- **Giành quyền trước khi gửi** để hai lần chạy song song không cùng gửi. Claim quá 10 phút được coi là mồ côi (worker chết), để email không bị kẹt mãi.
- **Payload chỉ chứa id:** job chạy muộn (sau retry, hoặc sau 30 phút) luôn thấy trạng thái mới nhất, ví dụ không nhắc thanh toán đơn đã trả.
- **Dead-letter thành queue riêng:** hiện trên cùng Bull Board, có số đếm riêng, không lẫn với các job failed sẽ bị dọn theo `removeOnFail`.

## Đánh đổi

- **Mất job khi Redis sập đúng lúc đẩy.** Event phát sau commit, còn job đẩy trong listener; giữa hai bước không có transaction chung.
  - Redis sập: lệnh `add` nằm chờ trong offline queue của ioredis và tự gửi khi kết nối lại. Gửi muộn vẫn an toàn vì jobId cố định.
  - Listener bỏ chờ sau 2 giây và log `Enqueue … failed`.
  - Job **chỉ mất** nếu process cũng khởi động lại trong lúc đó.
  - Hướng mở rộng nếu cần bảo đảm tuyệt đối: transactional outbox, tức ghi job vào bảng trong cùng transaction đặt đơn, rồi có worker đẩy sang BullMQ.
- **Có thể gửi trùng trong một trường hợp hẹp:** worker chết **sau khi** SMTP đã nhận thư nhưng **trước khi** kịp ghi `SENT`. Sau 10 phút claim được giành lại và thư được gửi lần hai.
  - Ta chọn "không mất email" hơn "không bao giờ trùng".
  - `Message-ID` cố định giúp nhiều hệ thống thư gộp bản trùng.
- **Báo cáo ngày** gửi riêng từng admin. Một admin lỗi thì job ném lỗi sau khi đã gửi cho những người còn lại; lần thử sau chỉ gửi cho người còn thiếu.
- **Bull Board nằm ngoài guard của Nest**, nên rate limit (ADR-0008) không áp vào. Rủi ro thấp vì chỉ ADMIN vào được.
  - Cookie chứa chính access token, giới hạn path `/admin/queues`, httpOnly và `SameSite=Strict` để chống CSRF.
  - Các nút retry, xoá của Bull Board có hiệu lực thật trên queue.
- **Hoá đơn lưu trên đĩa local** (volume `invoices`): nhiều instance thì mỗi instance có thư mục riêng. Production nhiều máy cần chuyển sang object storage (S3).
- **Đối tác giả lập** lưu khoá chống trùng trong RAM. API thật phải tự hỗ trợ idempotency key.
- **Seed không dọn queue.** Job cũ trỏ tới đơn đã bị xoá sẽ vào dead-letter với lý do "not found".

## Xử lý khi sự cố

- **Xem tình trạng:** mở `/admin/queues`, sau khi admin gọi `POST /api/admin/queues/session` từ Swagger trên cùng trình duyệt. Hoặc gọi `GET /api/admin/queues/stats`. `dead-letter` có job đang chờ nghĩa là có việc đã hết lượt thử; chi tiết lý do nằm trong data của job.
- **Xử lý job trong dead-letter:** sửa nguyên nhân (SMTP, đối tác…), rồi retry job gốc ở trạng thái failed của queue gốc trên Bull Board. Retry an toàn vì có idempotent. Sau đó xoá bản trong dead-letter.
- **SMTP hỏng:** job email thử 5 lần, chờ 2s → 4s → 8s → 16s giữa các lần (khoảng 30 giây), rồi vào dead-letter. Đơn hàng không bị ảnh hưởng.
- **Đối tác hỏng lâu:** `inventory-sync` vào dead-letter sau 6 lần thử. Khi đối tác hồi phục thì retry hàng loạt từ Bull Board; đối tác nhận khoá chống trùng.
- **Redis sập:** API vẫn nhận đơn; listener log `Enqueue … failed`; worker log `Worker … error` và tự kết nối lại.
- **Dừng xử lý khẩn cấp:** đặt `QUEUE_WORKERS_ENABLED=false` rồi khởi động lại; job vẫn được đẩy và nằm chờ. Có thể pause từng queue trên Bull Board.
- **Kiểm email ở dev:** Mailpit UI tại `http://127.0.0.1:8025`. Bảng `email_deliveries` cho biết thư nào đã gửi (`SENT`) hoặc đang gửi dở (`SENDING`). Xoá dòng tương ứng nếu muốn cố ý gửi lại.
