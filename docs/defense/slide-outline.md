# Dàn ý slide bảo vệ (10 phút)

Tổng 11 slide. Phần demo chiếm nhiều thời gian nhất vì rubric ưu tiên sản phẩm chạy thật.

| #   | Thời lượng | Slide                        | Tiêu chí rubric        | Nội dung chính                                                                                     |
| --- | ---------- | ---------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | 0:20       | Mở đầu                       |                        | Tên đề tài, người thực hiện, link production                                                       |
| 2   | 0:40       | Bài toán                     | Sản phẩm chạy thật     | Sàn ~200.000 khách: tranh mua, giá phải đúng, CSKH quá tải, phát hành không gián đoạn              |
| 3   | 0:50       | Kiến trúc                    | Tích hợp               | Sơ đồ tổng thể trong `docs/architecture.md`; nhấn: chỉ Nginx mở cổng, Postgres/Redis ở mạng nội bộ |
| 4   | 0:40       | Tám chủ đề tích hợp          | Tích hợp               | Bảng `docs/spec-summary.md`, mỗi chủ đề một bài toán                                               |
| 5   | 0:40       | Hai người mua món cuối       | Chất lượng mã          | `UPDATE ... WHERE stock >= qty`, sắp theo `productId`, Idempotency-Key                             |
| 6   | 0:40       | AI có người xác nhận         | Tích hợp, bảo mật      | Tool chỉ đọc hoặc đề xuất; CAS `PENDING → EXECUTING`; grounding                                    |
| 7   | 3:00       | Demo trực tiếp               | Sản phẩm chạy thật     | Theo `demo-script.md`: pipeline, realtime, 429, agent, Bull Board, tắt Redis                       |
| 8   | 0:50       | Pipeline và rollback         | Tự động hoá triển khai | Luồng deploy; kết quả đo thật: tổng thời gian, thời gian rollback                                  |
| 9   | 0:50       | Bảo mật và vận hành          | Bảo mật và vận hành    | OIDC, cổng 22 tạm, SG, secret; backup S3, biên bản diễn tập; suy giảm khi Redis lỗi                |
| 10  | 0:40       | Chất lượng mã                | Chất lượng mã          | Tách controller/service/repository, 16 ADR, coverage service, CI bắt buộc                          |
| 11  | 0:30       | Giới hạn và hướng phát triển |                        | Một EC2 là điểm lỗi đơn, RPO 24 giờ; bước tiếp: nhiều máy, WAL archiving                           |

## Số liệu cần điền từ lần chạy thật

Không dùng ước lượng trên slide. Lấy từ tab Actions, log rollback và `docs/restore-drill.md`.

- Thời gian pipeline từ push tới deploy xong.
- Thời gian `rollback.sh`.
- Số unit test, e2e test và coverage tầng service.
- Thời gian diễn tập khôi phục.
- Số liệu cache trong `docs/perf/cache-benchmark.md`.

## Mẹo trình bày

- Mở sẵn tab trình duyệt và terminal, không gõ URL trước hội đồng.
- Ghi màn hình toàn bộ demo trước một ngày làm phương án dự phòng.
- Mỗi slide một ý, nói lý do trước, chi tiết kỹ thuật sau.
