# ADR-0014: CD theo mô hình pull: EC2 tự kéo bản mới

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-31

## Bối cảnh

Push `main` phải đưa được bản mới lên EC2. Ràng buộc:

- Chỉ dùng EC2 làm máy chủ, không thêm SSM hay ECR (ADR-0013).
- Không lưu AWS access key dài hạn ở GitHub.
- Cổng 22 chỉ mở cho IP quản trị, trong khi runner của GitHub đổi IP mỗi lần chạy.
- Build trên EC2 mất 10–15 phút và chiếm tài nguyên máy đang phục vụ khách, không đạt mục tiêu pipeline dưới 10 phút.
- **IAM Identity providers không dùng được với gói tài khoản hiện tại**, nên GitHub Actions không lấy được quyền AWS bằng OIDC. Yêu cầu ban đầu về OIDC vì vậy không thực hiện được.

## Lựa chọn

Đảo chiều kết nối: GitHub không vào EC2, EC2 tự ra ngoài lấy bản mới.

1. `deploy.yml`: CI xanh → build trên runner → đẩy image tag full SHA lên GHCR bằng `GITHUB_TOKEN` tạm thời → dời tag git `production` → chờ `/health/live` báo đúng SHA, quá 5 phút thì fail.
2. Cron mỗi phút chạy `shopfast-pull-deploy` trên EC2: đọc tag `production`, kiểm commit thuộc `main`, kéo image, chạy `deploy.sh <sha>`.

Phương án đã loại:

| Phương án                           | Lý do loại                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| OIDC + mở cổng 22 tạm               | Identity providers bị khoá theo gói tài khoản                                            |
| Nâng gói AWS để dùng OIDC           | Chuyển tài khoản sang tính phí chỉ vì một bước deploy                                    |
| Mở cổng 22 cho `0.0.0.0/0`          | Trái yêu cầu, sshd chịu quét liên tục                                                    |
| AWS access key trong GitHub Secrets | Sống lâu, phải tự xoay vòng, lộ là lộ quyền AWS                                          |
| SSM SendCommand                     | Thêm agent và role; workflow vẫn cần credential AWS                                      |
| Self-hosted runner trên EC2         | Repo public: PR từ fork có thể nhắm vào runner; runner có quyền Docker tức root trên máy |
| Chuyển image bằng SSH               | Vẫn phải mở cổng 22 cho runner                                                           |
| ECR                                 | Cần credential AWS ở GitHub; GHCR miễn phí và đã gắn với repo                            |
| Build trên EC2                      | Vượt 10 phút, ảnh hưởng khách                                                            |

## Lý do

- **Không có cổng vào mới và không có secret ở GitHub:** EC2 chỉ có kết nối ra, nên lộ repo settings cũng không có khoá nào vào server. `GITHUB_TOKEN` tự hết hạn sau khi job kết thúc.
- **Tag git thay vì polling GHCR:** repo public nên `git ls-remote` không cần xác thực, tag chỉ đổi sau khi cả hai image đã đẩy xong và CI đã xanh.
- **Kiểm commit thuộc `main`:** tag bị dời bậy tới nhánh khác cũng không deploy được.
- **`last_attempted_sha`:** bản lỗi không bị thử lại mỗi phút; pull lỗi thì chưa ghi nên phút sau tự thử lại.
- **Script nằm ở `/usr/local/bin`, ngoài repo:** `git checkout` không ghi đè script đang chạy.

## Đánh đổi

- **Không có OIDC.** Đây là điểm lệch so với yêu cầu, do giới hạn tài khoản. Mục tiêu của OIDC (không có AWS key dài hạn ở GitHub) vẫn đạt, vì GitHub không cần quyền AWS nào.
- **Deploy chậm thêm tối đa 1 phút**, và cron chạy mỗi phút dù không có gì mới.
- **Workflow biết lỗi muộn:** deploy lỗi hoặc rollback chỉ lộ ra khi hết 5 phút chờ; log chi tiết nằm trên server, không nằm trong GitHub.
- **Thêm phụ thuộc GHCR.** GHCR sập thì không có bản mới, nhưng site đang chạy và rollback không ảnh hưởng vì image giữ trên máy.
- **Image phải public.** Mã nguồn đã public và image không chứa secret nên không lộ thêm gì.
- **Ai ghi được repo thì deploy được.** Branch protection là lớp bảo vệ thật; commit vẫn phải thuộc `main` và tag chỉ dời sau khi CI xanh, trừ khi có người tự sửa tag.
- **Đổi `pull-deploy.sh` phải chạy lại `bootstrap-server.sh`**, vì bản đang chạy nằm ngoài repo.

## Xử lý khi sự cố

- **Workflow báo hết 5 phút chờ:** xem `/var/log/shopfast/deploy-pull.log` và `infra/.deploy/deploy.log` trên server.
- **Log báo `denied` khi pull:** package GHCR chưa public (`infra/aws/README.md`).
- **Muốn deploy lại đúng SHA đã lỗi:** xoá `infra/.deploy/last_attempted_sha`, cron sẽ thử lại ở phút sau.
- **Tag `production` bị dời sai:** chạy lại workflow **Deploy** của commit đúng, hoặc `rollback.sh` trên server.
- **Sau rollback tay, cron không deploy lại:** đúng thiết kế, SHA đó đã nằm trong `last_attempted_sha`; commit mới trên `main` sẽ deploy bình thường.
- **GitHub hoặc GHCR sập nhưng cần deploy gấp:** SSH bằng IP quản trị, `git pull`, `./infra/scripts/deploy.sh` (build tại chỗ).
