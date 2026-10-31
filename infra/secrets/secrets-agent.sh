#!/bin/sh
# Sidecar `secrets-agent` (ADR-0013): Postgres và Redis nằm trong mạng `internal` nên không gọi được
# SSM; sidecar lấy mật khẩu rồi ghi vào volume tmpfs (chỉ trong RAM) mount riêng cho từng service.
#
# Phải sống thường trực: tmpfs mất khi không còn container nào mount. Sau reboot, Postgres/Redis
# khởi động lại theo restart policy cho tới khi file có mặt, nên stack tự hồi phục.
set -eu

prefix="${SSM_PARAMETER_PREFIX:?Cần đặt SSM_PARAMETER_PREFIX}"

fetch() {
  value=$(aws ssm get-parameter --name "$prefix/$1" --with-decryption \
    --query Parameter.Value --output text)
  # Mật khẩu còn nằm trong redis.conf và URL kết nối: chỉ nhận ký tự không cần escape.
  case "$value" in
    '' | *[!A-Za-z0-9_-]*)
      echo "secrets-agent: $1 chỉ được chứa A-Z a-z 0-9 _ -" >&2
      exit 1
      ;;
  esac
  printf '%s' "$value"
}

# Mode 0444: Postgres đọc bằng root, Redis đọc bằng user redis; mỗi volume chỉ service đó mount.
write_file() {
  umask 0222
  rm -f "$1.tmp"
  printf '%s\n' "$2" >"$1.tmp"
  mv -f "$1.tmp" "$1"
}

postgres_password=$(fetch postgres/POSTGRES_PASSWORD)
redis_password=$(fetch redis/REDIS_PASSWORD)

write_file /run/shopfast/postgres/postgres_password "$postgres_password"
write_file /run/shopfast/redis/redis.conf "requirepass $redis_password
appendonly yes
dir /data"

unset postgres_password redis_password
echo "secrets-agent: đã ghi secret cho postgres, redis"
exec sleep infinity
