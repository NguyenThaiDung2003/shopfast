#!/bin/sh
# Tạo infra/.env với secret ngẫu nhiên: ./infra/scripts/init-env.sh <domain> <email>
# Không ghi đè file đã có: mật khẩu mới sẽ không khớp DB hiện tại.
set -eu

domain="${1:-}"
email="${2:-}"
if [ -z "$domain" ] || [ -z "$email" ]; then
  echo "Cách dùng: $0 <domain> <email>" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
if [ -e .env ]; then
  echo "infra/.env đã tồn tại, giữ nguyên" >&2
  exit 1
fi

umask 077
cat >.env <<CONFIG
DOMAIN=$domain
LETSENCRYPT_EMAIL=$email
POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
CONFIG

echo "Đã tạo infra/.env. Hãy lưu một bản ở nơi an toàn: mất file này là mất mật khẩu DB."
