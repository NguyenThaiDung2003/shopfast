# Diễn tập khôi phục backup

Mục tiêu: chứng minh backup khôi phục được, trong dưới 30 phút. Diễn tập ghi vào DB tạm `shopfast_restore_*`, không đụng DB `shopfast` và không ảnh hưởng khách.

## Cách chạy

Điều kiện: đã làm xong [infra/aws/README.md](../infra/aws/README.md).

```bash
ssh -i <key.pem> ubuntu@<ELASTIC_IP>
cd ~/shopfast

# 1. Ghi giờ bắt đầu
date -u +%FT%TZ

# 2. Tạo một bản backup mới, nhìn log xem cron có chạy đều không
./infra/scripts/backup.sh
tail -n 5 /var/log/shopfast/backup.log

# 3. Liệt kê backup, lấy key mới nhất
BUCKET=$(sed -n 's/^BACKUP_S3_BUCKET=//p' infra/.env)
aws s3 ls "s3://$BUCKET/postgres/" --recursive | sort | tail -n 5

# 4. Khôi phục và đối chiếu
./infra/scripts/restore.sh postgres/YYYY/MM/shopfast-YYYY-MM-DD-HHMMSS.dump

# 5. Ghi giờ kết thúc
date -u +%FT%TZ
```

Script in bảng số dòng và tổng thời gian, rồi xoá DB tạm. Muốn xem thêm dữ liệu thì thêm `--keep`, xem xong xoá tay:

```bash
docker compose -f infra/docker-compose.prod.yml exec postgres psql -U shopfast -d shopfast_restore_<ts>
docker compose -f infra/docker-compose.prod.yml exec postgres psql -U shopfast -d postgres -c 'DROP DATABASE shopfast_restore_<ts>'
```

Cột `db-hien-tai` có thể lớn hơn `ban-backup` nếu có dữ liệu mới sau lúc backup. Bảng có dữ liệu mà bản khôi phục rỗng thì script exit 1.

## Biên bản

Mỗi lần diễn tập chép một bản bảng dưới đây và điền bằng số liệu thật.

### Lần 1: 2026-10-31

| Mục                   | Giá trị                                            |
| --------------------- | -------------------------------------------------- |
| Thời điểm diễn tập    | 2026-10-31 16:51 UTC (23:51 giờ Việt Nam)          |
| Người thực hiện       | Claude Code, chạy qua SSH theo yêu cầu chủ dự án   |
| Commit đang chạy      | `4906359dea8a86f473bc74972228b0508a6035e1`         |
| Bản backup dùng       | `postgres/2026/10/shopfast-2026-10-31-165101.dump` |
| Dung lượng bản backup | 68.359 byte                                        |
| Thời gian bắt đầu     | 16:51:01 UTC                                       |
| Thời gian kết thúc    | 16:51:12 UTC                                       |
| Tổng thời gian        | 11 giây (mục tiêu: < 30 phút)                      |
| Kết quả chung         | Đạt                                                |

#### Các bước đã làm

| #   | Bước                               | Bắt đầu  | Kết thúc | Kết quả                     |
| --- | ---------------------------------- | -------- | -------- | --------------------------- |
| 1   | Tạo backup bằng `backup.sh`        | 16:51:01 | 16:51:04 | Đạt, đã lên S3              |
| 2   | Xác định key trên S3               | 16:51:04 | 16:51:07 | Đạt                         |
| 3   | Tải và khôi phục bằng `restore.sh` | 16:51:07 | 16:51:12 | Đạt, exit 0                 |
| 4   | Đối chiếu số dòng                  | 16:51:07 | 16:51:12 | Đạt, nằm trong `restore.sh` |
| 5   | Xác nhận DB tạm đã xoá             | 16:51:12 | 16:51:12 | Đạt, chỉ còn DB `shopfast`  |

#### Kết quả kiểm tra

| Bảng                   | Bản backup | DB hiện tại | Chênh lệch |
| ---------------------- | ---------- | ----------- | ---------- |
| `_prisma_migrations`   | 9          | 9           | 0          |
| `users`                | 25         | 25          | 0          |
| `products`             | 200        | 200         | 0          |
| `orders`               | 50         | 50          | 0          |
| `order_items`          | 128        | 128         | 0          |
| `order_status_history` | 147        | 147         | 0          |
| `tickets`              | 3          | 3           | 0          |

#### Vấn đề gặp phải

| Vấn đề                                | Nguyên nhân                                | Cách xử lý                                                       | Việc cần làm tiếp                       |
| ------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------- |
| Role EC2 bị `AccessDenied` với bucket | Policy của role không khớp bucket          | Sửa policy theo `infra/aws/policies/instance-backup-policy.json` | Không                                   |
| Số đo chưa đại diện cho dữ liệu lớn   | DB chỉ có dữ liệu demo, dump 68 KB         | Ghi nhận giới hạn                                                | Diễn tập lại khi dữ liệu tăng           |
| Chưa diễn tập mất EC2                 | Lần này khôi phục vào DB tạm trên cùng máy | Ghi nhận giới hạn                                                | Tập mục "Khôi phục thật" trên máy mới   |
| Chưa thấy cron backup chạy thật       | Lần chạy này là chạy tay                   | Chờ tới 02:00 giờ Việt Nam                                       | Kiểm tra `/var/log/shopfast/backup.log` |

## Khôi phục thật (mất EC2)

Thao tác này thay dữ liệu production, chỉ làm khi có sự cố thật.

1. Dựng EC2 mới theo [infra/README.md](../infra/README.md), trỏ Elastic IP sang. Khôi phục `infra/.env` từ bản đã lưu ngoài máy, gắn role `shopfast-ec2`.
2. Bật Postgres (image tự tạo DB `shopfast` trống):
   ```bash
   cd ~/shopfast/infra
   docker compose -f docker-compose.prod.yml up -d postgres
   ```
3. Tải bản backup rồi khôi phục vào DB `shopfast`:
   ```bash
   BUCKET=$(sed -n 's/^BACKUP_S3_BUCKET=//p' .env)
   aws s3 cp "s3://$BUCKET/<key>" /tmp/restore.dump
   docker compose -f docker-compose.prod.yml exec -T postgres \
     pg_restore -U shopfast -d shopfast --clean --if-exists --no-owner --exit-on-error </tmp/restore.dump
   ```
4. Chạy `./scripts/deploy.sh` rồi kiểm tra `/health` và đăng nhập thử.

Dữ liệu sau bản backup cuối sẽ mất (RPO tối đa 24 giờ, [ADR-0016](adr/0016-backup-postgres-len-s3.md)). Hoá đơn PDF không có trong dump.
