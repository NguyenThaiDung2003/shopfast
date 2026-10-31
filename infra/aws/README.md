# Thiết lập AWS cho CD và backup

Làm trên AWS Console, khoảng 15 phút. Sau bước này: push vào `main` tự deploy, DB được backup lên S3 mỗi ngày. Lý do thiết kế ở [ADR-0014](../../docs/adr/0014-cd-ec2-tu-keo-ban-moi.md) và [ADR-0016](../../docs/adr/0016-backup-postgres-len-s3.md).

Chỉ dùng EC2, IAM và một S3 bucket. Region `ap-southeast-2`. Không tạo access key ở bất kỳ bước nào.

Chuẩn bị hai giá trị dùng xuyên suốt:

| Tên            | Lấy ở đâu                                                |
| -------------- | -------------------------------------------------------- |
| `<ACCOUNT_ID>` | 12 chữ số, bấm tên tài khoản ở góc trên bên phải Console |
| `<BUCKET>`     | Tự đặt: `shopfast-backup-<ACCOUNT_ID>`                   |

## 1. S3 bucket backup

1. S3 → **Create bucket**. Tên `<BUCKET>`, region `ap-southeast-2`.
2. Giữ **Block all public access** đang bật. Chọn **Bucket Versioning: Enable**. Bấm Create.
3. Vào bucket → tab **Management** → **Create lifecycle rule**:
   - Tên `expire-old-backups`, prefix `postgres/`.
   - Tick **Expire current versions of objects**: 30 ngày.
   - Tick **Permanently delete noncurrent versions of objects**: 30 ngày.
   - Tick **Delete incomplete multipart uploads**: 7 ngày.

## 2. Instance role cho EC2

Role này chỉ đọc/ghi prefix `postgres/` của bucket, không xoá được backup.

1. IAM → Policies → **Create policy** → tab JSON → dán [policies/instance-backup-policy.json](policies/instance-backup-policy.json), thay `<BUCKET>`. Đặt tên `shopfast-backup`.
2. IAM → Roles → **Create role** → AWS service → **EC2**. Gắn policy `shopfast-backup`. Đặt tên `shopfast-ec2`.
3. EC2 → chọn instance → **Actions → Security → Modify IAM role** → chọn `shopfast-ec2`.

## 3. Security Group và Elastic IP

Inbound của Security Group (EC2 → instance → tab Security) phải đúng như sau, không có rule nào khác:

| Cổng | Nguồn            | Ghi chú           |
| ---- | ---------------- | ----------------- |
| 80   | `0.0.0.0/0`      |                   |
| 443  | `0.0.0.0/0`      |                   |
| 22   | IP của bạn `/32` | Không để Anywhere |

Không mở 5432, 6379. Nếu EC2 chưa có Elastic IP: EC2 → Elastic IPs → Allocate → Associate vào instance. Không có Elastic IP thì stop/start máy sẽ đổi IP, làm hỏng `DOMAIN`.

## 4. Server

GitHub không kết nối vào EC2: cron trên máy tự kéo bản mới ([ADR-0014](../../docs/adr/0014-cd-ec2-tu-keo-ban-moi.md)).

```bash
cd ~/shopfast
./infra/scripts/bootstrap-server.sh
echo 'BACKUP_S3_BUCKET=<BUCKET>' >> infra/.env
echo 'BACKUP_S3_REGION=ap-southeast-2' >> infra/.env
./infra/scripts/backup.sh
```

`backup.sh` phải in dòng `Xong: s3://…`. Báo lỗi `Unable to locate credentials` nghĩa là chưa gắn role ở bước 2.

## 5. Package GHCR

Sau lần workflow **Deploy** đầu tiên, GitHub → Packages → lần lượt `shopfast-api`, `shopfast-web` → Package settings → **Change visibility → Public**. Trước đó server báo `denied` khi pull và tự thử lại mỗi phút; workflow lần đầu có thể fail vì hết 5 phút chờ, nhưng server vẫn tự deploy sau khi đổi xong.

## 6. Tài khoản IAM cho người

Không dùng root hằng ngày, không tạo access key dài hạn.

1. Bật MFA cho root: tên tài khoản → Security credentials → **Assign MFA device**.
2. IAM → User groups → **Create group** `shopfast-admins`, gắn policy `AdministratorAccess`. Người chỉ cần xem thì tạo group riêng với `ReadOnlyAccess`.
3. IAM → Users → **Create user**: tick **Provide user access to the AWS Management Console**, thêm vào group. **Không** gắn policy trực tiếp cho user.
4. Người dùng đăng nhập lần đầu, tự vào Security credentials → **Assign MFA device**.
5. Kiểm tra IAM → Users → cột **Access key** phải trống với mọi user.

## Kiểm tra sau khi xong

- `curl -m 5 <ELASTIC_IP>:5432` và `:6379` phải timeout.
- Merge một PR nhỏ: tab Actions có workflow **Deploy** xanh; `curl https://<domain>/health/live` trả đúng `commit`.
- `tail /var/log/shopfast/deploy-pull.log` trên server có dòng `Kéo image`.
