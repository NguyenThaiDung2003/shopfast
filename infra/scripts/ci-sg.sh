#!/bin/sh
# Workflow deploy mở/đóng cổng 22 cho IP của runner (ADR-0014): ./infra/scripts/ci-sg.sh <open|close>
# Cần EC2_SG_ID và quyền AWS từ OIDC. `open` dọn cả rule sót lại khi lần chạy trước bị huỷ giữa chừng.
set -eu

description=gha-deploy

close() {
  ids=$(aws ec2 describe-security-group-rules \
    --filters "Name=group-id,Values=$EC2_SG_ID" \
    --query "SecurityGroupRules[?Description=='$description'].SecurityGroupRuleId" \
    --output text)
  for id in $ids; do
    aws ec2 revoke-security-group-ingress --group-id "$EC2_SG_ID" --security-group-rule-ids "$id" >/dev/null
    echo "Đã gỡ rule $id"
  done
}

case "${1:-}" in
  open)
    close
    ip=$(curl -fsS -m 10 https://checkip.amazonaws.com)
    aws ec2 authorize-security-group-ingress --group-id "$EC2_SG_ID" \
      --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$ip/32,Description=$description}]" >/dev/null
    echo "Đã mở cổng 22 cho $ip"
    ;;
  close)
    close
    ;;
  *)
    echo "Cách dùng: $0 <open|close>" >&2
    exit 2
    ;;
esac
