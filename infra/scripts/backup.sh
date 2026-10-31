#!/bin/sh
# Sao lưu DB lên S3 qua instance role (ADR-0016): ./infra/scripts/backup.sh
# Cron chạy hằng ngày (bootstrap-server.sh); deploy.sh gọi thêm trước khi có migration mới.
set -eu

cd "$(dirname "$0")/.."
compose="docker compose -f docker-compose.prod.yml"

log() {
  echo "$(date -u +%FT%TZ) $*"
}

bucket=$(grep '^BACKUP_S3_BUCKET=' .env | tail -n 1 | cut -d= -f2-)
region=$(grep '^BACKUP_S3_REGION=' .env | tail -n 1 | cut -d= -f2-)
if [ -z "$bucket" ] || [ -z "$region" ]; then
  log "LỖI: thiếu BACKUP_S3_BUCKET hoặc BACKUP_S3_REGION trong infra/.env" >&2
  exit 1
fi

key=postgres/$(date -u +%Y/%m)/shopfast-$(date -u +%Y-%m-%d-%H%M%S).dump
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

log "Bắt đầu dump"
$compose exec -T postgres pg_dump -U shopfast -d shopfast -Fc -Z 6 >"$tmp"
# File hỏng hoặc rỗng phải báo lỗi ngay, không đợi đến lúc cần khôi phục mới biết.
$compose exec -T postgres pg_restore --list <"$tmp" >/dev/null

aws s3 cp "$tmp" "s3://$bucket/$key" --region "$region" --only-show-errors
log "Xong: s3://$bucket/$key ($(wc -c <"$tmp") byte)"
