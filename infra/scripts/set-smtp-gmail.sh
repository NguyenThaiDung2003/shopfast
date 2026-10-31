#!/bin/sh
# Cấu hình Gmail SMTP vào infra/.env: ./infra/scripts/set-smtp-gmail.sh
# Cần App Password (https://myaccount.google.com/apppasswords), không phải mật khẩu Gmail.
# Chạy deploy.sh sau đó để API nhận cấu hình mới.
set -eu

cd "$(dirname "$0")/.."

printf 'Địa chỉ Gmail: '
read -r address
printf 'App Password (không hiện khi gõ): '
stty -echo
trap 'stty echo' EXIT
read -r password
stty echo
trap - EXIT
echo

password=$(printf '%s' "$password" | tr -d ' ')
case "$address" in
  *@*) ;;
  *)
    echo "Địa chỉ Gmail không hợp lệ" >&2
    exit 1
    ;;
esac
if [ "${#password}" -ne 16 ]; then
  echo "App Password phải có 16 ký tự" >&2
  exit 1
fi

umask 077
grep -vE '^(SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASSWORD|MAIL_FROM)=' .env >.env.tmp || true
cat >>.env.tmp <<CONFIG
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=$address
SMTP_PASSWORD=$password
MAIL_FROM="ShopFast <$address>"
CONFIG
mv -f .env.tmp .env

echo "Đã ghi cấu hình Gmail. Chạy ./infra/scripts/deploy.sh để áp dụng."
