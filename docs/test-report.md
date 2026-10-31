# Báo cáo kiểm thử chuyên sâu

Thực hiện ngày 2026-11-01 (giờ Việt Nam), trên commit `01e28da` của `main` và nhánh sửa lỗi đi kèm báo cáo này.

## Tóm tắt

| Nhóm                            | Môi trường | Kết quả                                          |
| ------------------------------- | ---------- | ------------------------------------------------ |
| Bảo mật từ bên ngoài            | Production | 32/32 đạt, thêm kiểm tra TLS, header, cổng       |
| Reboot EC2                      | Production | Đạt, gián đoạn khoảng 46 giây                    |
| Tranh chấp đồng thời            | Stack dev  | 15/15 đạt                                        |
| Giao diện bằng trình duyệt thật | Stack dev  | 34/35, 1 lần không tái hiện được                 |
| Hỏng hạ tầng                    | Stack dev  | Tìm ra 1 lỗi mất email, đã sửa                   |
| Đo tải                          | Stack dev  | 0 lỗi, chỉ để so sánh                            |
| Prompt injection với LLM thật   |            | **Chưa kiểm chứng được**, key Gemini bị giới hạn |

Stack dev là máy Windows 8 GB chạy Docker Desktop, nên số tải không đại diện cho production. Các script kiểm thử chạy một lần, không nằm trong repo; test tái hiện lỗi đã thêm vào `email-jobs.service.spec.ts` và `jobs.e2e-spec.ts`.

## Lỗi tìm được

### Mất email khi worker chết (đã sửa)

- **Tái hiện:** đặt 12 đơn rồi `docker kill -s KILL` API. Mất 2/12 thư xác nhận, dòng `email_deliveries` kẹt ở `SENDING`, job kết thúc với `skipped/already_sent` dù thư chưa gửi.
- **Nguyên nhân:** BullMQ chạy lại job treo sau khoảng 30 giây. Lúc đó claim chưa quá 10 phút, code coi như đã gửi nên kết thúc job, không còn lần chạy nào giành lại claim.
- **Sửa:** `claim` phân biệt `claimed`, `sent`, `busy`. Gặp `busy` thì job hoãn tới lúc claim hết hạn, không tính vào số lần thử ([ADR-0009](adr/0009-background-jobs-bullmq.md)).
- **Đo lại với bản sửa:** thiếu 0/12. Có 3/12 thư gửi trùng do worker chết sau khi SMTP đã nhận thư, trước khi ghi `SENT`. Đây là đánh đổi ADR-0009 đã chọn: thà trùng còn hơn mất. `Message-ID` cố định giúp hệ thống thư gộp bản trùng. Phép thử này cố ý giết tiến trình đúng lúc đang gửi hàng loạt.

### Header lộ thông tin, thiếu CSP (đã sửa trong cấu hình)

Response có `Server: nginx/1.28.3` và `X-Powered-By: Express`, trang web chưa có Content-Security-Policy trong khi token nằm ở localStorage. Đã thêm `server_tokens off`, ẩn `X-Powered-By`, và CSP cho trang web. Cấu hình qua `nginx -t`; **CSP chưa được kiểm tra trên trình duyệt production** cho tới khi merge và restart Nginx.

### Trang chủ 375 px tràn ngang một lần (không tái hiện)

Một lượt đo thấy `scrollWidth` 395/375. Năm lượt sau, gồm lấy mẫu liên tục trong lúc tải với bộ nhớ đệm trống, đều 375/375. Chưa rõ nguyên nhân, không sửa mù.

### Điểm cần lưu ý, chưa sửa

- Đăng nhập khi Postgres chết trả 500 thay vì 503. Thông điệp vẫn sạch, tiếng Việt, không lộ nội bộ.
- Hai dòng `SENDING` từ trước khi sửa trên stack dev không tự hết vì job của chúng đã kết thúc. Chỉ có ở stack dev, do phép thử gây ra.

## Bảo mật, production

Chỉ gửi request vào hệ thống của mình, tốc độ thấp.

| Hạng mục               | Kết quả                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| TLS                    | Cert Let's Encrypt tới 2027-01-29; TLS 1.2, 1.3 đạt; TLS 1.1 bị từ chối |
| HTTP và IP             | 301 về HTTPS và domain chính                                            |
| Cổng                   | 3000, 5432, 6379 đóng                                                   |
| Swagger, file nhạy cảm | `/docs` chỉ là trang SPA, `/.env` và `/.git/config` không lộ nội dung   |
| JWT                    | `alg:none`, sửa role giữ chữ ký, ký bằng secret đoán, chuỗi rác: 401    |
| Phân quyền             | 9 tình huống sai vai trò hoặc thiếu token: đúng 401/403                 |
| Đọc chéo               | Khách đọc đơn khách khác: 404                                           |
| Refresh token          | Dùng lại token cũ: 401, cả family bị thu hồi                            |
| Injection, đầu vào xấu | SQL trong tham số, id quá lớn, JSON hỏng: 400; body 3 MB: 413           |
| CORS                   | Không cấp cho origin lạ                                                 |
| Giả `X-Forwarded-For`  | Vẫn bị chặn theo IP thật, 429 từ lần 7 của lượt thử                     |
| Bull Board             | Không cookie: 401; khách: 403; admin: 200                               |

Dev: gửi `role=ADMIN` khi đăng ký không có tác dụng, 50/50 tài khoản là `CUSTOMER`.

## Reboot production

Backup lên S3 trước khi reboot. Mất dịch vụ tại giây 9, `/health` trả `ok` tại giây 55, tức gián đoạn khoảng 46 giây. Sau reboot: đúng màu `api-green`, đúng commit, web và API trả 200, cron chạy, không có deploy ngoài ý muốn.

## Tranh chấp đồng thời, dev

| Kịch bản                                 | Kết quả                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| 50 người mua món còn 1                   | 1 đơn, 49 lỗi `OUT_OF_STOCK`, tồn kho 0, 630 ms, không 5xx |
| 20 request cùng `Idempotency-Key`        | 1 đơn, trừ kho 1 lần, 19 replay                            |
| 30 đơn hai sản phẩm, thêm giỏ đảo thứ tự | 30/30 thành công, không deadlock, tồn kho khớp             |
| 10 kho đổi cùng một đơn                  | 1 thành công, 9 lỗi 409, history thêm 1 dòng               |
| Huỷ và chuyển trạng thái đua nhau        | 1 bên thắng, hoàn kho đúng                                 |
| Đổi giá rồi đọc ngay, 30 vòng            | Không đọc phải giá cũ                                      |

## Hỏng hạ tầng, dev

| Kịch bản              | Kết quả                                                                           |
| --------------------- | --------------------------------------------------------------------------------- |
| Redis tắt khi đặt đơn | 6/6 đơn thành công, `/health` degraded 200, không mất email sau khi Redis trở lại |
| OTP khi Redis tắt     | 503 tiếng Việt                                                                    |
| Postgres tắt          | `/health` 503, `/health/live` 200, không lộ nội bộ, tự kết nối lại sau 1,1 giây   |
| SIGTERM khi có tải    | 574 request đều 200, thoát mã 143 sau 5,5 giây                                    |
| LLM bị giới hạn       | 503 `AI_UNAVAILABLE`, không lộ nhà cung cấp                                       |

## Giao diện, dev

Chromium headless qua Playwright.

- Mua hàng từ danh sách tới thành công, bấm đúp nút đặt: đúng 1 email trong Mailpit.
- Realtime: giao diện đổi sau 366 ms; mất mạng hiện trạng thái, nối lại tự bù thay đổi bị lỡ.
- Access token hỏng: tự refresh, không bị đăng xuất.
- XSS qua ticket: payload không chạy ở bàn CSKH.
- Ma trận quyền và mở Bull Board: đạt.
- 16 lượt kiểm tra cuộn ngang ở 375 px và 1280 px: 15 đạt, 1 như đã nêu.
- Không có lỗi JavaScript trên console.

## Tải, dev

autocannon 10 kết nối, 10 giây, tắt rate limit.

| Endpoint          | req/s | p50   | p97,5 | p99   | Lỗi |
| ----------------- | ----- | ----- | ----- | ----- | --- |
| Chi tiết sản phẩm | 499   | 18 ms | 35 ms | 42 ms | 0   |
| Danh sách có lọc  | 399   | 23 ms | 39 ms | 46 ms | 0   |

## Chưa kiểm chứng

- **Prompt injection với LLM thật:** Gemini trả `rate_limited` suốt thời gian thử. Hệ thống an toàn ở tầng thiết kế (model không có tool ghi) và có unit test, nhưng chưa có kết quả chạy thật.
- **Trợ lý AI trên giao diện:** cùng lý do. Luồng API đã đạt trước đó trên production.
- **Cron backup tự chạy:** xem `/var/log/shopfast/backup.log` sau 02:00 giờ Việt Nam.
- **Banner 429 và email qua Gmail thật** trên trình duyệt: chưa thử.
- **Tải trên production:** cố ý không làm.
- **Mất EC2 hoàn toàn:** chưa dựng lại trên máy mới.
