#!/bin/sh
# Cấp chứng chỉ lần đầu: ./infra/scripts/init-letsencrypt.sh [--staging]
# Đọc DOMAIN, LETSENCRYPT_EMAIL từ infra/.env. DNS của DOMAIN phải trỏ về EC2, cổng 80 mở.
# deploy.sh tự gọi script này ở lần đầu.
#
# Nginx không khởi động được khi thiếu file cert, mà Let's Encrypt lại cần Nginx phục vụ webroot:
# tạo cert tự ký tạm, bật Nginx, xin cert thật rồi reload.
set -eu

staging=""
if [ "${1:-}" = "--staging" ]; then
  staging="--staging"
fi

cd "$(dirname "$0")/.."
DOMAIN=$(sed -n 's/^DOMAIN=//p' .env)
LETSENCRYPT_EMAIL=$(sed -n 's/^LETSENCRYPT_EMAIL=//p' .env)
: "${DOMAIN:?Thiếu DOMAIN trong infra/.env}"
: "${LETSENCRYPT_EMAIL:?Thiếu LETSENCRYPT_EMAIL trong infra/.env}"

compose="docker compose -f docker-compose.prod.yml"
live="/etc/letsencrypt/live/$DOMAIN"

# Nginx cần upstream để đọc được cấu hình; màu blue là mặc định lần đầu.
[ -f nginx/upstream/active.conf ] || cp nginx/upstream/blue.conf nginx/upstream/active.conf

dummy_cert() {
  $compose run --rm --no-deps --entrypoint sh certbot -c "
    mkdir -p '$live' &&
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj '/CN=$DOMAIN' \
      -keyout '$live/privkey.pem' -out '$live/fullchain.pem'"
}

remove_cert() {
  $compose run --rm --no-deps --entrypoint sh certbot -c "
    rm -rf '$live' '/etc/letsencrypt/archive/$DOMAIN' '/etc/letsencrypt/renewal/$DOMAIN.conf'"
}

if $compose run --rm --no-deps --entrypoint sh certbot -c \
  "test -f '/etc/letsencrypt/renewal/$DOMAIN.conf'"; then
  echo "Đã có chứng chỉ cho $DOMAIN, không làm gì. Gia hạn do service certbot đảm nhận."
  exit 0
fi

dummy_cert
$compose up -d nginx

# Certbot không ghi đè thư mục live không do nó tạo. Nginx vẫn giữ cert tạm trong RAM.
remove_cert
# shellcheck disable=SC2086 # $staging rỗng thì không truyền đối số nào
if ! $compose run --rm --no-deps --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$LETSENCRYPT_EMAIL" \
  --agree-tos --no-eff-email --non-interactive $staging; then
  dummy_cert
  echo "Cấp chứng chỉ thất bại, Nginx đang dùng cert tự ký. Kiểm DNS và cổng 80 rồi chạy lại." >&2
  exit 1
fi

$compose exec -T nginx nginx -s reload
$compose up -d certbot
echo "Đã cấp chứng chỉ cho $DOMAIN"
