#!/bin/bash
# Quay về một bản đã deploy: ./infra/scripts/rollback.sh [sha]
# Không truyền sha: lấy bản tốt liền trước trong .deploy/deploy_history. Dùng image có sẵn trên máy,
# không build, không chạy migration (schema giữ nguyên, nên migration phải tương thích ngược).
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=infra/scripts/deploy-lib.sh
. scripts/deploy-lib.sh

started=$SECONDS
target=${1:-}
if [ -z "$target" ]; then
  [ -f "$state/deploy_history" ] && [ "$(wc -l <"$state/deploy_history")" -ge 2 ] ||
    die "Chưa có bản trước trong deploy_history, hãy truyền sha"
  target=$(tail -n 2 "$state/deploy_history" | head -n 1 | cut -d' ' -f2)
fi

take_lock
log_to_file "rollback $target"

docker image inspect "shopfast-api:$target" "shopfast-web:$target" >/dev/null 2>&1 ||
  die "Thiếu image của $target trên máy"
export IMAGE_TAG=$target

current=$(active_color)
next=$(other_color "$current")

if [ "$(running_tag "$current")" = "$target" ]; then
  echo "api-$current đã chạy bản $target"
  next=$current
elif [ "$(running_tag "$next")" = "$target" ]; then
  echo "== api-$next vẫn đang chạy bản $target, chỉ đổi upstream"
  ./scripts/switch-upstream.sh "$next"
else
  echo "== Bật api-$next bản $target"
  $compose up -d --no-deps --force-recreate "api-$next"
  wait_healthy "$next" || die "api-$next không healthy, traffic giữ nguyên ở api-$current"
  ./scripts/switch-upstream.sh "$next"
fi

$compose up -d --no-deps web

verify_public || die "Sau rollback /health vẫn lỗi qua Nginx, cần xử lý tay"

if [ "$next" != "$current" ]; then
  $compose stop "api-$current"
fi

record_good "$target"
echo "== Xong: api-$next chạy bản $target sau $((SECONDS - started))s"
