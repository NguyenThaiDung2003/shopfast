#!/bin/sh
# Deploy blue-green bản code hiện tại: ./infra/scripts/deploy.sh
# Dùng cho cả lần đầu và cập nhật (`git pull` trước). Màu mới không healthy thì traffic giữ nguyên.
set -eu

cd "$(dirname "$0")/.."
compose="docker compose -f docker-compose.prod.yml"
active=nginx/upstream/active.conf

if [ ! -f .env ]; then
  echo "Chưa có infra/.env, chạy infra/scripts/init-env.sh trước" >&2
  exit 1
fi

IMAGE_TAG=$(git rev-parse --short HEAD)
export IMAGE_TAG

echo "== Build bản $IMAGE_TAG"
docker build -f ../apps/api/Dockerfile -t "shopfast-api:$IMAGE_TAG" -t shopfast-api:latest ..
docker build -f ../apps/web/Dockerfile -t "shopfast-web:$IMAGE_TAG" -t shopfast-web:latest ..

# Luôn gọi: đã có cert thì script thoát ngay; lần trước xin lỗi thì lần này xin lại.
./scripts/init-letsencrypt.sh

current=blue
next=green
if grep -q api-green "$active"; then
  current=green
  next=blue
fi
# Màu đang trỏ tới chưa chạy (lần đầu): bật luôn màu đó, không có gì để thay.
if [ -z "$($compose ps -q --status running "api-$current")" ]; then
  next=$current
fi

$compose up -d postgres redis
echo "== Migrate"
$compose run --rm migrate
$compose up -d --no-deps web

echo "== Bật api-$next"
$compose up -d --no-deps --force-recreate "api-$next"

tries=0
while :; do
  container=$($compose ps -q "api-$next")
  health=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo starting)
  [ "$health" = healthy ] && break
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    echo "api-$next không healthy sau 2 phút, giữ nguyên traffic. Log gần nhất:" >&2
    $compose logs --tail 30 "api-$next" >&2
    $compose stop "api-$next"
    exit 1
  fi
  sleep 2
done

./scripts/switch-upstream.sh "$next"

if [ "$next" != "$current" ]; then
  $compose stop "api-$current"
fi
echo "== Xong: api-$next đang chạy bản $IMAGE_TAG"
