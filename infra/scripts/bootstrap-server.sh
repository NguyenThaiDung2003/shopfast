#!/bin/sh
# Chuẩn bị server cho CD và backup, chạy lại an toàn: ./infra/scripts/bootstrap-server.sh "<public key deploy>"
# Xem infra/aws/README.md.
set -eu

cd "$(dirname "$0")/.."
public_key=${1:-}
if ! printf '%s' "$public_key" | grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$'; then
  echo "Cách dùng: $0 \"ssh-ed25519 AAAA... shopfast-deploy\"" >&2
  exit 2
fi

# aws-cli chạy trên host nên dùng được instance role mà không cần sửa IMDS hop limit.
if ! command -v aws >/dev/null 2>&1; then
  sudo snap install aws-cli --classic
fi

sudo install -m 755 scripts/ci-entry.sh /usr/local/bin/shopfast-ci-entry
sudo install -d -o "$(id -un)" -g "$(id -gn)" /var/log/shopfast

# 19:00 UTC = 02:00 giờ Việt Nam; server dùng UTC.
sudo tee /etc/cron.d/shopfast-backup >/dev/null <<EOF
PATH=/snap/bin:/usr/local/bin:/usr/bin:/bin
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

# Key chỉ chạy được shopfast-ci-entry, không shell, không forward.
key_body=$(printf '%s' "$public_key" | cut -d' ' -f1,2)
touch "$HOME/.ssh/authorized_keys"
if ! grep -qF "$key_body" "$HOME/.ssh/authorized_keys"; then
  echo "restrict,command=\"/usr/local/bin/shopfast-ci-entry\" $key_body shopfast-deploy" >>"$HOME/.ssh/authorized_keys"
fi

echo "Xong. Thêm BACKUP_S3_BUCKET và BACKUP_S3_REGION vào infra/.env rồi chạy thử ./infra/scripts/backup.sh"
