#!/bin/bash
# Hàm dùng chung của deploy.sh và rollback.sh; chạy với cwd = infra/.
# shellcheck disable=SC2034 # biến dùng ở script nạp file này

compose="docker compose -f docker-compose.prod.yml"
active=nginx/upstream/active.conf
state=.deploy
health_timeout=${HEALTH_TIMEOUT_SECONDS:-120}

mkdir -p "$state"

die() {
  echo "LỖI: $*" >&2
  exit 1
}

# Ghi log ra file và vẫn in ra stdout để workflow thấy. `tee -p`: SSH đứt thì script vẫn chạy tiếp.
log_to_file() {
  if [ -z "${SHOPFAST_DEPLOY_LOGGING:-}" ]; then
    export SHOPFAST_DEPLOY_LOGGING=1
    exec > >(tee -p -a "$state/deploy.log") 2>&1
  fi
  echo "== $(date -u +%FT%TZ) $*"
}

# Chống chạy chồng. Lần gọi lồng nhau (deploy gọi rollback) dùng lại khoá của tiến trình cha.
take_lock() {
  [ -n "${SHOPFAST_DEPLOY_LOCKED:-}" ] && return 0
  exec 9>"$state/lock"
  flock -n 9 || die "Đang có deploy hoặc rollback khác chạy"
  export SHOPFAST_DEPLOY_LOCKED=1
}

env_value() {
  grep "^$1=" .env | tail -n 1 | cut -d= -f2-
}

active_color() {
  if grep -q api-green "$active" 2>/dev/null; then echo green; else echo blue; fi
}

other_color() {
  if [ "$1" = blue ]; then echo green; else echo blue; fi
}

is_running() {
  [ -n "$($compose ps -q --status running "api-$1")" ]
}

# Tag image của container đang chạy, rỗng nếu màu đó không chạy.
running_tag() {
  local container
  container=$($compose ps -q --status running "api-$1")
  [ -n "$container" ] || return 0
  docker inspect -f '{{.Config.Image}}' "$container" | cut -d: -f2
}

wait_healthy() {
  local color=$1 deadline=$((SECONDS + health_timeout)) container health
  while [ "$SECONDS" -lt "$deadline" ]; do
    container=$($compose ps -q "api-$color")
    health=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo starting)
    [ "$health" = healthy ] && return 0
    sleep 2
  done
  echo "api-$color không healthy sau ${health_timeout}s. Log gần nhất:" >&2
  $compose logs --tail 30 "api-$color" >&2
  return 1
}

# Gọi qua đúng đường của khách (TLS + Nginx). Cần 5 lần đạt liên tiếp để loại lần đạt do may mắn.
# Có đối số: /health/live phải báo đúng commit đó. Bản cũ chưa có trường commit thì rollback không truyền.
verify_public() {
  local expected=${1:-} domain passes=0 tries=0 body
  domain=$(env_value DOMAIN)
  while [ "$tries" -lt 20 ]; do
    tries=$((tries + 1))
    if curl -fsS -m 5 -o /dev/null --resolve "$domain:443:127.0.0.1" "https://$domain/health" &&
      body=$(curl -fsS -m 5 --resolve "$domain:443:127.0.0.1" "https://$domain/health/live") &&
      { [ -z "$expected" ] || [[ "$body" == *"\"commit\":\"$expected\""* ]]; }; then
      passes=$((passes + 1))
      [ "$passes" -ge 5 ] && return 0
    else
      passes=0
    fi
    sleep 1
  done
  return 1
}

record_good() {
  echo "$1" >"$state/last_good_sha"
  if [ "$(tail -n 1 "$state/deploy_history" 2>/dev/null | cut -d' ' -f2)" != "$1" ]; then
    echo "$(date -u +%FT%TZ) $1" >>"$state/deploy_history"
  fi
}

# Giữ 5 bản mới nhất của mỗi image để rollback không cần build hay tải lại.
prune_images() {
  local repo tag
  for repo in shopfast-api shopfast-web; do
    docker images "$repo" --format '{{.Tag}}' | grep -v '^seed$' | tail -n +6 | while read -r tag; do
      docker rmi "$repo:$tag" >/dev/null 2>&1 || true
    done
  done
  docker image prune -f >/dev/null
}
