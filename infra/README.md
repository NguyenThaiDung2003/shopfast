# infra

Hạ tầng triển khai của ShopFast.

Môi trường **dev** dùng `docker-compose.yml` ở gốc repo (api + postgres:16 + redis:7) – xem [README → Chạy cục bộ](../README.md#chạy-cục-bộ) và [ADR-0002](../docs/adr/0002-mo-hinh-du-lieu-va-moi-truong-dev.md).

**Production** chạy trên một EC2, không cần dịch vụ AWS nào khác: [docker-compose.prod.yml](docker-compose.prod.yml), lý do thiết kế ở [ADR-0013](../docs/adr/0013-trien-khai-production-blue-green.md).

| Đường dẫn                                                                      | Vai trò                                                                                                                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [scripts/init-env.sh](scripts/init-env.sh)                                     | Tạo `infra/.env` với secret ngẫu nhiên                                                                                                          |
| [scripts/deploy.sh](scripts/deploy.sh)                                         | Deploy blue-green, dùng cho cả lần đầu                                                                                                          |
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

Muốn gửi email thật hoặc bật AI: thêm `SMTP_*`, `LLM_*` vào `infra/.env` (mẫu ở `.env.example`) rồi deploy lại.

## Cập nhật bản mới

```bash
cd ~/shopfast && git pull && ./infra/scripts/deploy.sh
```

Script build, migrate, bật màu còn lại, chờ healthy, đổi traffic rồi dừng màu cũ. Màu mới không healthy sau 2 phút thì dừng lại, traffic giữ nguyên ở màu cũ. Migration phải tương thích ngược với bản đang chạy.

Rollback: `git checkout <commit cũ>` rồi chạy lại `deploy.sh`.

## Vận hành

Các lệnh dưới chạy trong `~/shopfast/infra`:

```bash
alias dc='docker compose -f docker-compose.prod.yml'
dc ps -a
dc logs --tail 50 api-blue
dc logs nginx
```

- **Gia hạn cert:** tự động mỗi 12 giờ, Nginx reload trong vòng 5 phút sau khi có cert mới.
- **Sửa cấu hình Nginx:** `dc restart nginx` (template chỉ được render khi khởi động).
- **Dữ liệu:** image production không có seed nên DB ban đầu trống.
- Xử lý sự cố: [ADR-0013](../docs/adr/0013-trien-khai-production-blue-green.md#xử-lý-khi-sự-cố).

Phần sẽ bổ sung: script sao lưu DB.
