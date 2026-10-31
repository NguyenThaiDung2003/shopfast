# infra

Hạ tầng triển khai của ShopFast.

Môi trường **dev** dùng `docker-compose.yml` ở gốc repo (api + postgres:16 + redis:7) – xem [README → Chạy cục bộ](../README.md#chạy-cục-bộ) và [ADR-0002](../docs/adr/0002-mo-hinh-du-lieu-va-moi-truong-dev.md).

**Production** chạy trên một EC2, chỉ thêm IAM và một S3 bucket backup: [docker-compose.prod.yml](docker-compose.prod.yml), lý do thiết kế ở [ADR-0013](../docs/adr/0013-trien-khai-production-blue-green.md).

| Đường dẫn                                                                      | Vai trò                                                                                                                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [scripts/init-env.sh](scripts/init-env.sh)                                     | Tạo `infra/.env` với secret ngẫu nhiên                                                                                                          |
| [scripts/deploy.sh](scripts/deploy.sh)                                         | Deploy blue-green: `<sha>` dùng image có sẵn, không đối số thì build tại chỗ                                                                    |
| [scripts/rollback.sh](scripts/rollback.sh)                                     | Quay về bản đã deploy, dưới 2 phút                                                                                                              |
| [scripts/ci-entry.sh](scripts/ci-entry.sh), [ci-sg.sh](scripts/ci-sg.sh)       | Lệnh của SSH key deploy; mở/đóng cổng 22 cho runner                                                                                             |
| [scripts/backup.sh](scripts/backup.sh), [restore.sh](scripts/restore.sh)       | Backup lên S3; khôi phục vào DB mới để kiểm tra                                                                                                 |
| [scripts/bootstrap-server.sh](scripts/bootstrap-server.sh)                     | Chuẩn bị server cho CD và backup                                                                                                                |
| [aws/](aws/README.md)                                                          | Hướng dẫn thiết lập IAM, OIDC, S3, Security Group                                                                                               |
| [scripts/switch-upstream.sh](scripts/switch-upstream.sh)                       | Đổi màu thủ công                                                                                                                                |
| [scripts/init-letsencrypt.sh](scripts/init-letsencrypt.sh)                     | Cấp chứng chỉ, `deploy.sh` tự gọi                                                                                                               |
| [nginx/templates/default.conf.template](nginx/templates/default.conf.template) | HTTP → HTTPS, TLS, web tĩnh                                                                                                                     |
| [nginx/api.conf](nginx/api.conf)                                               | Proxy `/api`, `/health`, `/admin/queues`, `/socket.io`; API chạy `TRUST_PROXY=1` ([ADR-0008](../docs/adr/0008-rate-limit-va-khoa-dang-nhap.md)) |
| [nginx/upstream/](nginx/upstream/)                                             | `blue.conf`, `green.conf`; `active.conf` do script sinh                                                                                         |
| [.env.example](.env.example)                                                   | Mẫu cấu hình                                                                                                                                    |

## Lần đầu

1. Tạo EC2 Ubuntu 24.04, `t3.medium`, 30 GB. Security group: 80 và 443 từ Anywhere, 22 chỉ từ IP của bạn. Gắn Elastic IP.
2. Trỏ bản ghi A của domain về Elastic IP. Chưa có domain thì dùng `<ip-nối-bằng-gạch>.sslip.io`, ví dụ `13-229-1-2.sslip.io`.
3. SSH vào máy, cài Docker và swap (build cần thêm bộ nhớ), rồi đăng nhập lại:

   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker ubuntu
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   exit
   ```

4. Lấy code, tạo cấu hình và deploy (build mất khoảng 10–15 phút):

   ```bash
   git clone https://github.com/NguyenThaiDung2003/shopfast.git ~/shopfast
   cd ~/shopfast
   ./infra/scripts/init-env.sh <domain> <email thật>
   ./infra/scripts/deploy.sh
   curl -s https://<domain>/health
   ```

   Email phải là email thật, Let's Encrypt từ chối địa chỉ giả.

5. Lưu một bản `infra/.env` ở nơi an toàn. Mất file này là mất mật khẩu DB và `JWT_SECRET`.

Muốn bật AI: thêm `LLM_*` vào `infra/.env` (mẫu ở `.env.example`) rồi deploy lại.

Dữ liệu demo: `./infra/scripts/seed-demo.sh` (chỉ chạy khi DB còn trống). Mật khẩu tài khoản mẫu nằm ở `SEED_USER_PASSWORD` trong `infra/.env`.

Email bằng Gmail: bật xác minh 2 bước, tạo [App Password](https://myaccount.google.com/apppasswords), rồi chạy `./infra/scripts/set-smtp-gmail.sh && ./infra/scripts/deploy.sh`. Gmail giới hạn khoảng 500 email/ngày, chỉ phù hợp demo.

HTTPS chỉ hợp lệ với `DOMAIN`. Let's Encrypt không cấp cert cho tên `*.amazonaws.com`, nên tên đó chỉ dùng được qua HTTP và tự chuyển về `DOMAIN`.

## Cập nhật bản mới

Sau khi xong [aws/README.md](aws/README.md): merge vào `main`, workflow **Deploy** tự chạy CI, build, chuyển image rồi gọi `deploy.sh <sha>`. Server ở trạng thái detached HEAD theo commit đã deploy.

Không có GitHub thì deploy tay:

```bash
cd ~/shopfast && git checkout main && git pull && ./infra/scripts/deploy.sh
```

`deploy.sh` backup nếu có migration mới, migrate, bật màu còn lại, chờ healthy, đổi traffic, kiểm tra qua Nginx, drain 30 giây rồi dừng màu cũ. Lỗi trước khi đổi thì traffic giữ nguyên; lỗi sau khi đổi thì tự rollback. Migration phải tương thích ngược ([ADR-0015](../docs/adr/0015-zero-downtime-va-gioi-han.md)).

Rollback tay: `./infra/scripts/rollback.sh` về bản tốt liền trước, hoặc `./infra/scripts/rollback.sh <sha>`. Máy giữ 5 bản gần nhất; xem `infra/.deploy/deploy_history`.

## Vận hành

Các lệnh dưới chạy trong `~/shopfast/infra`:

```bash
alias dc='docker compose -f docker-compose.prod.yml'
dc ps -a
cat .deploy/last_good_sha
tail -n 50 .deploy/deploy.log
tail -n 20 /var/log/shopfast/backup.log
dc logs --tail 50 api-blue
dc logs nginx
```

- **Gia hạn cert:** tự động mỗi 12 giờ, Nginx reload trong vòng 5 phút sau khi có cert mới.
- **Sửa cấu hình Nginx:** `dc restart nginx` (template chỉ được render khi khởi động).
- Xử lý sự cố: [ADR-0013](../docs/adr/0013-trien-khai-production-blue-green.md#xử-lý-khi-sự-cố).

- **Backup:** cron 02:00 giờ Việt Nam, diễn tập theo [docs/restore-drill.md](../docs/restore-drill.md).
