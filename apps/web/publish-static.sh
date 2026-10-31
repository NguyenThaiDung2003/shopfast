#!/bin/sh
# Đổ bản build vào volume `web_static` mà không cần khởi động lại Nginx (ADR-0013).
# Giữ file hash của bản cũ 14 ngày cho trình duyệt đang mở; index.html ghi sau cùng và thay nguyên
# tử để không bao giờ trỏ tới file chưa có.
set -eu

target=/srv/web

find /dist -mindepth 1 -maxdepth 1 ! -name index.html -exec cp -r {} "$target/" \;
if [ -d "$target/assets" ]; then
  find "$target/assets" -type f -mtime +14 -delete
fi
cp /dist/index.html "$target/.index.html.tmp"
mv -f "$target/.index.html.tmp" "$target/index.html"
