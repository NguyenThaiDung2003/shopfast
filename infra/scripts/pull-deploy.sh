#!/bin/sh
# Cron gọi mỗi phút (ADR-0014): tag `production` đổi thì kéo image của commit đó rồi chạy deploy.sh.
# bootstrap-server.sh cài bản sao vào /usr/local/bin: `git checkout` không được ghi đè script đang chạy.
# Đổi file này phải chạy lại bootstrap-server.sh.
set -eu

registry=ghcr.io/nguyenthaidung2003
# PULL_REF chỉ để diễn tập các nhánh từ chối.
ref=${PULL_REF:-refs/tags/production}

cd "$HOME/shopfast"
mkdir -p infra/.deploy
attempted=infra/.deploy/last_attempted_sha

exec 8>infra/.deploy/pull.lock
flock -n 8 || exit 0

sha=$(git ls-remote origin "$ref" | cut -f1)
[ -n "$sha" ] || exit 0
[ "$sha" != "$(cat "$attempted" 2>/dev/null || true)" ] || exit 0

log() {
  echo "$(date -u +%FT%TZ) $*"
}

git fetch --quiet origin +refs/heads/main:refs/remotes/origin/main "$sha"
if ! git merge-base --is-ancestor "$sha" origin/main; then
  log "Từ chối $sha: không thuộc nhánh main"
  echo "$sha" >"$attempted"
  exit 1
fi

# Pull lỗi thì chưa ghi attempted để phút sau thử lại (mạng, package chưa public).
log "Kéo image $sha"
for name in shopfast-api shopfast-web; do
  docker pull --quiet "$registry/$name:$sha" >/dev/null
  docker tag "$registry/$name:$sha" "$name:$sha"
  docker rmi "$registry/$name:$sha" >/dev/null
done

git -c advice.detachedHead=false checkout --quiet --detach "$sha"

# Ghi trước khi deploy: bản lỗi không được thử lại mỗi phút.
echo "$sha" >"$attempted"
exec infra/scripts/deploy.sh "$sha"
