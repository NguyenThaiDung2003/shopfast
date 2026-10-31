#!/bin/sh
# Lệnh duy nhất SSH key deploy chạy được (`command=` trong authorized_keys, ADR-0014).
# bootstrap-server.sh cài bản sao vào /usr/local/bin: `git checkout` không được ghi đè script đang chạy.
#   load-images    nạp `docker save | gzip` từ stdin
#   deploy <sha>   lấy đúng commit của main rồi chạy deploy.sh
set -eu

# SSH đứt giữa chừng thì deploy vẫn chạy nốt, không bỏ dở giữa hai màu.
trap '' HUP

set -f
# shellcheck disable=SC2086 # cố ý tách từ
set -- ${SSH_ORIGINAL_COMMAND:-}
set +f

case "${1:-}:$#" in
  load-images:1)
    gzip -dc | docker load
    ;;
  deploy:2)
    sha=$2
    if ! printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$'; then
      echo "SHA không hợp lệ" >&2
      exit 2
    fi
    cd "$HOME/shopfast"
    git fetch --quiet origin +refs/heads/main:refs/remotes/origin/main
    if ! git merge-base --is-ancestor "$sha" origin/main; then
      echo "$sha không thuộc nhánh main" >&2
      exit 2
    fi
    git -c advice.detachedHead=false checkout --quiet --detach "$sha"
    exec infra/scripts/deploy.sh "$sha"
    ;;
  *)
    echo "Lệnh không được phép" >&2
    exit 2
    ;;
esac
