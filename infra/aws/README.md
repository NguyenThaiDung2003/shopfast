# Thiết lập AWS cho CD và backup

Làm trên AWS Console, khoảng 25 phút. Sau bước này: push vào `main` tự deploy, DB được backup lên S3 mỗi ngày. Lý do thiết kế ở [ADR-0014](../../docs/adr/0014-oidc-va-cong-ssh-tam-thoi.md) và [ADR-0016](../../docs/adr/0016-backup-postgres-len-s3.md).

Chỉ dùng EC2, IAM và một S3 bucket. Region `ap-southeast-2`. Không tạo access key ở bất kỳ bước nào.

Chuẩn bị ba giá trị dùng xuyên suốt:

| Tên            | Lấy ở đâu                                                  |
| -------------- | ---------------------------------------------------------- |
| `<ACCOUNT_ID>` | 12 chữ số, bấm tên tài khoản ở góc trên bên phải Console   |
| `<SG_ID>`      | EC2 → Instances → instance → tab Security, dạng `sg-0abc…` |
| `<BUCKET>`     | Tự đặt: `shopfast-backup-<ACCOUNT_ID>`                     |

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

## 3. OIDC cho GitHub Actions

1. IAM → Identity providers → **Add provider** → OpenID Connect:
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
2. IAM → Policies → **Create policy** → dán [policies/github-deploy-policy.json](policies/github-deploy-policy.json), thay `<REGION>`, `<ACCOUNT_ID>`, `<SG_ID>`. Đặt tên `shopfast-github-deploy`.
3. IAM → Roles → **Create role** → **Custom trust policy** → dán [policies/github-deploy-trust.json](policies/github-deploy-trust.json), thay `<ACCOUNT_ID>`. Gắn policy `shopfast-github-deploy`. Đặt tên `shopfast-github-deploy`. Ghi lại ARN của role.

Role chỉ tin workflow chạy trên nhánh `main` của repo này: fork và nhánh khác không lấy được quyền.

## 4. Security Group và Elastic IP

Inbound của `<SG_ID>` phải đúng như sau, không có rule nào khác:

| Cổng | Nguồn            | Ghi chú                                                     |
| ---- | ---------------- | ----------------------------------------------------------- |
| 80   | `0.0.0.0/0`      |                                                             |
| 443  | `0.0.0.0/0`      |                                                             |
| 22   | IP của bạn `/32` | Không để Anywhere. Workflow tự thêm và gỡ rule `gha-deploy` |

Không mở 5432, 6379. Nếu EC2 chưa có Elastic IP: EC2 → Elastic IPs → Allocate → Associate vào instance. Không có Elastic IP thì stop/start máy sẽ đổi IP, làm hỏng `DOMAIN`.

## 5. SSH key deploy và server

Trên máy bạn, tạo key riêng (không dùng lại key EC2):

```bash
ssh-keygen -t ed25519 -f shopfast-deploy -N "" -C shopfast-deploy
ssh-keyscan -t ed25519 <ELASTIC_IP>
```

Trên EC2:

```bash
cd ~/shopfast
./infra/scripts/bootstrap-server.sh "<nội dung shopfast-deploy.pub>"
echo 'BACKUP_S3_BUCKET=<BUCKET>' >> infra/.env
echo 'BACKUP_S3_REGION=ap-southeast-2' >> infra/.env
./infra/scripts/backup.sh
```

`backup.sh` phải in dòng `Xong: s3://…`. Báo lỗi `Unable to locate credentials` nghĩa là chưa gắn role ở bước 2.

## 6. Cấu hình trên GitHub

Settings → Secrets and variables → Actions.

| Loại     | Tên               | Giá trị                                  |
| -------- | ----------------- | ---------------------------------------- |
| Secret   | `DEPLOY_SSH_KEY`  | Toàn bộ file `shopfast-deploy` (private) |
| Variable | `AWS_ROLE_ARN`    | ARN role ở bước 3                        |
| Variable | `AWS_REGION`      | `ap-southeast-2`                         |
| Variable | `EC2_HOST`        | Elastic IP                               |
| Variable | `EC2_SG_ID`       | `<SG_ID>`                                |
| Variable | `EC2_KNOWN_HOSTS` | Dòng in ra từ `ssh-keyscan`              |

Xong thì xoá file private key trên máy bạn: GitHub đã giữ bản duy nhất cần dùng. Mất key thì tạo key mới và chạy lại `bootstrap-server.sh`.

## 7. Tài khoản IAM cho người

Không dùng root hằng ngày, không tạo access key dài hạn.

1. Bật MFA cho root: tên tài khoản → Security credentials → **Assign MFA device**.
2. IAM → User groups → **Create group** `shopfast-admins`, gắn policy `AdministratorAccess`. Người chỉ cần xem thì tạo group riêng với `ReadOnlyAccess`.
3. IAM → Users → **Create user**: tick **Provide user access to the AWS Management Console**, thêm vào group. **Không** gắn policy trực tiếp cho user.
4. Người dùng đăng nhập lần đầu, tự vào Security credentials → **Assign MFA device**.
5. Kiểm tra IAM → Users → cột **Access key** phải trống với mọi user.

## Kiểm tra sau khi xong

- `curl -m 5 <ELASTIC_IP>:5432` và `:6379` phải timeout.
- Merge một PR nhỏ: tab Actions có workflow **Deploy** xanh; `curl https://<domain>/health/live` trả đúng `commit`.
- Security Group không còn rule `gha-deploy`.

## Thu hồi quyền khi nghi lộ

- SSH key: xoá dòng `shopfast-deploy` trong `~/.ssh/authorized_keys` trên EC2, xoá Secret `DEPLOY_SSH_KEY`.
- GitHub bị chiếm: xoá role `shopfast-github-deploy` ở IAM.
