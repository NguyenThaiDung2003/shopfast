#!/bin/sh
# Chuẩn bị server cho CD và backup, chạy lại an toàn: ./infra/scripts/bootstrap-server.sh
# Xem infra/aws/README.md.
set -eu

cd "$(dirname "$0")/.."

# aws-cli chạy trên host nên dùng được instance role mà không cần sửa IMDS hop limit.
if ! command -v aws >/dev/null 2>&1; then
  sudo snap install aws-cli --classic
fi

sudo install -m 755 scripts/pull-deploy.sh /usr/local/bin/shopfast-pull-deploy
sudo install -d -o "$(id -un)" -g "$(id -gn)" /var/log/shopfast

# 19:00 UTC = 02:00 giờ Việt Nam; server dùng UTC.
sudo tee /etc/cron.d/shopfast >/dev/null <<EOF
PATH=/snap/bin:/usr/local/bin:/usr/bin:/bin
* * * * * $(id -un) /usr/local/bin/shopfast-pull-deploy >>/var/log/shopfast/deploy-pull.log 2>&1
0 19 * * * $(id -un) $PWD/scripts/backup.sh >>/var/log/shopfast/backup.log 2>&1
EOF

sudo tee /etc/logrotate.d/shopfast >/dev/null <<'EOF'
/var/log/shopfast/*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
EOF

echo "Xong. Thêm BACKUP_S3_BUCKET và BACKUP_S3_REGION vào infra/.env rồi chạy thử ./infra/scripts/backup.sh"
