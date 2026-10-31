#!/bin/sh
# Chuyển traffic sang api-blue hoặc api-green: ./infra/scripts/switch-upstream.sh <blue|green>
# Rollback = chạy lại với màu kia (màu cũ phải còn chạy). Reload Nginx không làm rớt request đang
# chạy; WebSocket cũ giữ tới khi màu cũ dừng rồi tự nối lại sang màu mới.
set -eu

color="${1:-}"
case "$color" in
  blue | green) ;;
  *)
    echo "Cách dùng: $0 <blue|green>" >&2
    exit 2
    ;;
esac

cd "$(dirname "$0")/.."
compose="docker compose -f docker-compose.prod.yml"
active=nginx/upstream/active.conf

container=$($compose ps -q "api-$color")
health=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo missing)
if [ "$health" != healthy ]; then
  echo "api-$color chưa healthy (trạng thái: $health), giữ nguyên upstream" >&2
  exit 1
fi

previous=$(cat "$active" 2>/dev/null || true)

# Ghi file tạm rồi mv để Nginx không bao giờ đọc phải file ghi dở.
cp "nginx/upstream/$color.conf" "$active.tmp"
mv -f "$active.tmp" "$active"

if ! $compose exec -T nginx nginx -t -q; then
  printf '%s\n' "$previous" >"$active"
  echo "Cấu hình Nginx lỗi, đã trả lại upstream cũ" >&2
  exit 1
fi

$compose exec -T nginx nginx -s reload
echo "Traffic đã chuyển sang api-$color"
