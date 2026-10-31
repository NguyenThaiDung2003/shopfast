#!/bin/sh
# Khôi phục một bản backup vào DB MỚI rồi đối chiếu số dòng: ./infra/scripts/restore.sh [--keep] <s3-key>
# Không bao giờ ghi vào DB `shopfast`. Mặc định xoá DB tạm khi xong; --keep để giữ lại xem tiếp.
set -eu

cd "$(dirname "$0")/.."
compose="docker compose -f docker-compose.prod.yml"

keep=
if [ "${1:-}" = --keep ]; then
  keep=1
  shift
fi
key=${1:-}
if ! printf '%s' "$key" | grep -Eq '^[A-Za-z0-9/._-]+$'; then
  echo "Cách dùng: $0 [--keep] <s3-key>, ví dụ postgres/2026/11/shopfast-2026-11-01-190000.dump" >&2
  exit 2
fi

bucket=$(grep '^BACKUP_S3_BUCKET=' .env | tail -n 1 | cut -d= -f2-)
region=$(grep '^BACKUP_S3_REGION=' .env | tail -n 1 | cut -d= -f2-)
db=shopfast_restore_$(date -u +%Y%m%d%H%M%S)
tmp=$(mktemp)
started=$(date +%s)

sql() {
  $compose exec -T postgres psql -U shopfast -d "$1" -v ON_ERROR_STOP=1 -Atc "$2"
}

cleanup() {
  rm -f "$tmp"
  if [ -z "$keep" ]; then
    sql postgres "DROP DATABASE IF EXISTS $db" >/dev/null || echo "Không xoá được DB tạm $db" >&2
  fi
}
trap cleanup EXIT

echo "== Tải s3://$bucket/$key"
aws s3 cp "s3://$bucket/$key" "$tmp" --region "$region" --only-show-errors

echo "== Khôi phục vào $db"
sql postgres "CREATE DATABASE $db" >/dev/null
$compose exec -T postgres pg_restore -U shopfast -d "$db" --no-owner --exit-on-error <"$tmp"

# DB gốc có thể nhiều dòng hơn vì nhận thêm dữ liệu sau lúc backup; bảng có dữ liệu mà bản khôi phục rỗng mới là lỗi.
echo "== Đối chiếu số dòng"
printf '%-24s %10s %10s\n' bang 'ban-backup' 'db-hien-tai'
failed=
for table in _prisma_migrations users products orders order_items order_status_history tickets; do
  restored=$(sql "$db" "SELECT count(*) FROM $table")
  source_rows=$(sql shopfast "SELECT count(*) FROM $table")
  printf '%-24s %10s %10s\n' "$table" "$restored" "$source_rows"
  if [ "$restored" = 0 ] && [ "$source_rows" != 0 ]; then
    failed=1
  fi
done

if [ -n "$failed" ]; then
  echo "LỖI: có bảng rỗng trong bản khôi phục" >&2
  exit 1
fi
[ -z "$keep" ] || echo "Giữ lại DB $db"
echo "== Xong sau $(($(date +%s) - started))s"
