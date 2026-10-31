#!/bin/sh
# Chạy nền trong container nginx (docker-entrypoint.d). Certbot không có Docker socket nên không tự
# reload Nginx được: deploy-hook chạm file đánh dấu, script này thấy thì reload. Không reload định
# kỳ để khỏi làm rớt WebSocket vô cớ.
marker=/etc/letsencrypt/.renewed

stamp() {
  stat -c %Y "$marker" 2>/dev/null || echo 0
}

(
  last=$(stamp)
  while sleep 300; do
    current=$(stamp)
    if [ "$current" != "$last" ]; then
      last=$current
      echo "watch-certs: chứng chỉ mới, reload nginx"
      nginx -s reload
    fi
  done
) &
