#!/bin/bash
# Deploy blue-green (ADR-0015).
#   ./infra/scripts/deploy.sh <sha>   dùng image đã có trên máy, CD gọi qua pull-deploy.sh
#   ./infra/scripts/deploy.sh         build tại chỗ từ HEAD: lần đầu, hoặc khi GitHub lỗi
# Lỗi trước khi đổi traffic: màu cũ giữ nguyên. Lỗi sau khi đổi: tự rollback. Cả hai đều exit 1.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=infra/scripts/deploy-lib.sh
. scripts/deploy-lib.sh

drain_seconds=${DRAIN_SECONDS:-30}
sha=${1:-}

[ -f .env ] || die "Chưa có infra/.env, chạy infra/scripts/init-env.sh trước"
take_lock
log_to_file "deploy ${sha:-HEAD}"

if [ -n "$sha" ]; then
  docker image inspect "shopfast-api:$sha" "shopfast-web:$sha" >/dev/null 2>&1 ||
    die "Thiếu image của $sha trên máy"
  IMAGE_TAG=$sha
else
  IMAGE_TAG=$(git rev-parse HEAD)
  echo "== Build bản $IMAGE_TAG"
  docker build -f ../apps/api/Dockerfile -t "shopfast-api:$IMAGE_TAG" ..
  docker build -f ../apps/web/Dockerfile -t "shopfast-web:$IMAGE_TAG" ..
fi
export IMAGE_TAG

# Luôn gọi: đã có cert thì script thoát ngay; lần trước xin lỗi thì lần này xin lại.
./scripts/init-letsencrypt.sh

current=$(active_color)
next=$(other_color "$current")
# Màu đang trỏ tới chưa chạy (lần đầu): bật luôn màu đó, không có gì để thay.
if ! is_running "$current"; then
  next=$current
fi
previous_tag=$(running_tag "$current")

$compose up -d postgres redis

# Backup chỉ khi có migration mới. Chưa cấu hình bucket thì cảnh báo, không chặn deploy.
last_good=$(cat "$state/last_good_sha" 2>/dev/null || true)
if [ -z "$last_good" ] || ! git diff --quiet "$last_good" HEAD -- ../apps/api/prisma/migrations 2>/dev/null; then
  if [ -n "$(env_value BACKUP_S3_BUCKET)" ]; then
    ./scripts/backup.sh
  else
    echo "CẢNH BÁO: chưa đặt BACKUP_S3_BUCKET, migrate mà không backup" >&2
  fi
fi

echo "== Migrate"
$compose run --rm migrate
$compose up -d --no-deps web

echo "== Bật api-$next ($IMAGE_TAG)"
$compose up -d --no-deps --force-recreate "api-$next"

if ! wait_healthy "$next"; then
  $compose stop "api-$next"
  die "api-$next không healthy, traffic giữ nguyên ở api-$current"
fi

if ! ./scripts/switch-upstream.sh "$next"; then
  $compose stop "api-$next"
  die "Không đổi được upstream, traffic giữ nguyên ở api-$current"
fi

# EXPECTED_COMMIT chỉ để diễn tập nhánh tự rollback.
if ! verify_public "${EXPECTED_COMMIT:-$IMAGE_TAG}"; then
  echo "Kiểm tra sau khi đổi traffic thất bại" >&2
  [ -n "$previous_tag" ] && [ "$next" != "$current" ] || die "Không có bản cũ để rollback"
  ./scripts/rollback.sh "$previous_tag"
  die "Đã rollback về $previous_tag"
fi

if [ "$next" != "$current" ]; then
  echo "== Drain ${drain_seconds}s rồi dừng api-$current"
  sleep "$drain_seconds"
  $compose stop "api-$current"
fi

record_good "$IMAGE_TAG"
prune_images
echo "== Xong: api-$next đang chạy bản $IMAGE_TAG"
