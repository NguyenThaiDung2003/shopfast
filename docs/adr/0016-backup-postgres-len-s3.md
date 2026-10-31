# ADR-0016: Backup Postgres lên S3

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-31

## Bối cảnh

Postgres chạy trong container trên EBS của chính EC2. Backup nằm cùng ổ thì hỏng máy là mất cả hai, nên cần một bản ngoài máy. Dự án chỉ dùng EC2 làm máy chủ (ADR-0013), S3 là ngoại lệ có chủ đích.

## Lựa chọn

- `backup.sh`: `pg_dump -Fc` (custom format, đã nén), kiểm file bằng `pg_restore --list`, upload `postgres/YYYY/MM/shopfast-<thời điểm>.dump`. Cron 02:00 giờ Việt Nam; `deploy.sh` gọi thêm trước migration mới.
- Xác thực bằng instance role, chỉ đọc/ghi prefix `postgres/`, không có quyền xoá.
- Bucket chặn public, bật versioning, lifecycle xoá sau 30 ngày.
- `restore.sh <s3-key>`: khôi phục vào DB mới, đối chiếu số dòng, xoá DB tạm.

| Phương án đã loại  | Lý do loại                                     |
| ------------------ | ---------------------------------------------- |
| Chỉ lưu trên EC2   | Không chống được hỏng máy                      |
| Tải về máy cá nhân | Phụ thuộc người nhớ làm, không tự động         |
| EBS snapshot       | Snapshot cả ổ, khó diễn tập khôi phục riêng DB |

## Lý do

- **Custom format:** khôi phục chọn lọc được và đã nén sẵn, không cần gzip thêm.
- **Kiểm file trước khi upload:** backup hỏng phải lộ ngay, không đợi lúc cần dùng.
- **Không cho role quyền xoá:** EC2 bị chiếm cũng không xoá được backup; ghi đè đã có versioning giữ bản cũ.
- **Khôi phục vào DB mới:** diễn tập trên production không chạm dữ liệu thật.
- **aws-cli trên host, không trong container:** mạng `backend` không có đường ra Internet, và host không vướng IMDS hop limit.

## Đánh đổi

- **RPO tối đa 24 giờ:** đơn phát sinh sau bản backup cuối sẽ mất khi hỏng máy. Giảm thêm phải dùng WAL archiving, chưa cần ở quy mô đồ án.
- **Dump không gồm `infra/.env` và volume `invoices`.** `.env` phải lưu riêng ở nơi an toàn. Hoá đơn PDF không có trong dump.
- **Không có cảnh báo chủ động:** cron lỗi chỉ ghi `/var/log/shopfast/backup.log`, phải kiểm tra định kỳ.
- **Cùng region và cùng tài khoản AWS:** chống hỏng máy, không chống mất tài khoản.
- **File dump không mã hoá phía client**, chỉ dựa vào mã hoá mặc định của S3 và quyền bucket.

## Xử lý khi sự cố

- **`Unable to locate credentials`:** instance chưa gắn role `shopfast-ec2`.
- **`AccessDenied`:** sai `BACKUP_S3_BUCKET` hoặc policy không khớp bucket.
- **Backup trước migrate lỗi:** `deploy.sh` dừng, chưa đổi gì. Sửa backup rồi deploy lại.
- **Mất EC2:** dựng máy mới theo `infra/README.md`, khôi phục `.env`, rồi làm theo mục "Khôi phục thật" trong `docs/restore-drill.md`.
