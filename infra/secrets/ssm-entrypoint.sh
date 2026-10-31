#!/bin/sh
# Entrypoint image API: nạp mọi tham số dưới SSM_PARAMETER_PATH vào biến môi trường của process
# rồi `exec` lệnh chính (ADR-0013). Xác thực bằng IAM role của EC2 qua IMDS, không có khoá tĩnh.
#
# - Secret chỉ nằm trong RAM của process, không ghi file. `docker exec` KHÔNG thấy các biến này.
# - Tên tham số cuối đường dẫn = tên biến; giá trị phải trên một dòng.
# - Không `eval` và không `set -x`: giá trị là dữ liệu, không được chạy và không được in ra log.
set -eu

path="${SSM_PARAMETER_PATH:?Cần đặt SSM_PARAMETER_PATH}"
path="${path%/}"

if ! params=$(aws ssm get-parameters-by-path \
  --path "$path" \
  --recursive \
  --with-decryption \
  --query 'Parameters[].[Name,Value]' \
  --output text); then
  echo "ssm-entrypoint: không đọc được $path (IAM role, IMDS hop limit, AWS_REGION?)" >&2
  exit 1
fi

if [ -z "$params" ]; then
  echo "ssm-entrypoint: không có tham số nào dưới $path" >&2
  exit 1
fi

tab=$(printf '\t')
count=0
# here-doc thay vì pipe: vòng lặp phải chạy trong shell này thì `export` mới có tác dụng.
while IFS="$tab" read -r full_name value; do
  case "$full_name" in
    "$path"/*) ;;
    *)
      echo "ssm-entrypoint: dòng không hợp lệ (giá trị nhiều dòng?)" >&2
      exit 1
      ;;
  esac
  name="${full_name##*/}"
  case "$name" in
    '' | [!A-Z]* | *[!A-Z0-9_]*)
      echo "ssm-entrypoint: tên tham số không hợp lệ: $name" >&2
      exit 1
      ;;
  esac
  export "$name=$value"
  count=$((count + 1))
done <<EOF
$params
EOF

echo "ssm-entrypoint: đã nạp $count tham số từ $path"
unset params
exec "$@"
