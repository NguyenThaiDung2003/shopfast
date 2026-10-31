#!/bin/sh
# Nạp dữ liệu demo vào DB production còn trống: ./infra/scripts/seed-demo.sh
# prisma/seed.ts TRUNCATE mọi bảng nên script từ chối chạy khi đã có user, không có cờ bỏ qua.
set -eu

cd "$(dirname "$0")/.."
compose="docker compose -f docker-compose.prod.yml"

users=$($compose exec -T postgres psql -U shopfast -d shopfast -Atc 'SELECT count(*) FROM users')
if [ "$users" != 0 ]; then
  echo "DB đã có $users user, seed sẽ xoá sạch dữ liệu nên không chạy" >&2
  exit 1
fi

if ! grep -q '^SEED_USER_PASSWORD=' .env; then
  (umask 077 && echo "SEED_USER_PASSWORD=$(openssl rand -hex 12)" >>.env)
fi

# Image production không có tsx; seed dùng stage dev.
docker build --target dev -f ../apps/api/Dockerfile -t shopfast-api:seed ..
$compose run --rm seed
echo "Đã seed. Tài khoản: admin01@shopfast.local, support01@…, warehouse01@…, customer01@…"
echo "Mật khẩu: grep SEED_USER_PASSWORD infra/.env"
