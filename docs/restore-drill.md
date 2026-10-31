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

## Biên bản (điền từ lần chạy thật)

| Mục                   | Giá trị             |
| --------------------- | ------------------- |
| Thời điểm diễn tập    |                     |
| Người thực hiện       |                     |
| Commit đang chạy      | `/health/live` →    |
| Bản backup dùng       | `postgres/...`      |
| Dung lượng bản backup |                     |
| Thời gian bắt đầu     |                     |
| Thời gian kết thúc    |                     |
| Tổng thời gian        | Mục tiêu: < 30 phút |
| Kết quả chung         | Đạt / Không đạt     |

### Các bước đã làm

| #   | Bước                               | Bắt đầu | Kết thúc | Kết quả |
| --- | ---------------------------------- | ------- | -------- | ------- |
| 1   | Tạo backup bằng `backup.sh`        |         |          |         |
| 2   | Xác định key trên S3               |         |          |         |
| 3   | Tải và khôi phục bằng `restore.sh` |         |          |         |
| 4   | Đối chiếu số dòng                  |         |          |         |
| 5   | Xác nhận DB tạm đã xoá             |         |          |         |

### Kết quả kiểm tra

| Bảng                   | Bản backup | DB hiện tại | Chênh lệch có giải thích được? |
| ---------------------- | ---------- | ----------- | ------------------------------ |
| `_prisma_migrations`   |            |             |                                |
| `users`                |            |             |                                |
| `products`             |            |             |                                |
| `orders`               |            |             |                                |
| `order_items`          |            |             |                                |
| `order_status_history` |            |             |                                |
| `tickets`              |            |             |                                |

### Vấn đề gặp phải

| Vấn đề | Nguyên nhân | Cách xử lý | Việc cần làm tiếp |
| ------ | ----------- | ---------- | ----------------- |
|        |             |            |                   |

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
