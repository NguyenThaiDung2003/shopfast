# ADR-0014: CD bằng OIDC và cổng SSH tạm, không access key, không SSM

- **Trạng thái:** Chấp nhận
- **Ngày:** 2026-10-31

## Bối cảnh

GitHub Actions cần đưa bản mới vào EC2 khi push `main`. Ràng buộc:

- Chỉ dùng EC2 làm máy chủ; không thêm dịch vụ chạy thường trực như SSM, ECR (ADR-0013).
- Không lưu AWS access key dài hạn ở GitHub: lộ key thì lộ tài khoản AWS tới khi có người phát hiện.
- Cổng 22 chỉ mở cho IP quản trị, trong khi runner của GitHub đổi IP mỗi lần chạy.
- Build trên EC2 mất 10–15 phút và chiếm tài nguyên của máy đang phục vụ khách, không đạt mục tiêu pipeline dưới 10 phút.

## Lựa chọn

- **Build trên runner**, image gắn tag full SHA, chuyển vào máy bằng `docker save | gzip | ssh`.
- **OIDC:** workflow đổi token GitHub lấy credential tạm của role `shopfast-github-deploy`. Role chỉ tin đúng `repo:NguyenThaiDung2003/shopfast:ref:refs/heads/main`, chỉ sửa được ingress của đúng Security Group.
- **Cổng SSH tạm:** `ci-sg.sh open` thêm `IP runner/32` với mô tả `gha-deploy`; bước `if: always()` gỡ ra. Lần chạy sau dọn cả rule sót lại.
- **SSH key riêng, bị khoá lệnh:** `authorized_keys` đặt `restrict,command=` trỏ tới `shopfast-ci-entry`, chỉ nhận `load-images` và `deploy <sha 40 hex thuộc main>`.

Phương án đã loại:

| Phương án                           | Lý do loại                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| SSM SendCommand                     | Thêm agent, role và dịch vụ; đã bỏ SSM ở ADR-0013                                        |
| Access key IAM trong GitHub Secrets | Sống lâu, phải tự xoay vòng                                                              |
| Mở 22 cho `0.0.0.0/0`               | Đơn giản nhất nhưng trái yêu cầu, sshd chịu quét liên tục                                |
| Self-hosted runner trên EC2         | Repo public: PR từ fork có thể nhắm vào runner; runner có quyền Docker tức root trên máy |
| ECR hoặc GHCR                       | Thêm một bước đăng nhập và một nơi giữ image; một máy thì giữ image ngay trên máy là đủ  |
| Build trên EC2                      | Vượt 10 phút, ảnh hưởng khách                                                            |

## Lý do

- Credential OIDC hết hạn sau khoảng 1 giờ và chỉ phát cho workflow trên `main`, nên không có khoá dài hạn để mất.
- Cổng 22 mở vài phút cho đúng một IP, thay vì thường trực.
- `ci-entry.sh` nằm ở `/usr/local/bin`, ngoài repo: `git checkout` không ghi đè script đang chạy, và commit mới không tự mở rộng quyền của key.
- Không đặt `environment` trong job deploy, vì nó đổi claim `sub` và role sẽ từ chối.

## Đánh đổi

- **Vẫn còn một secret dài hạn:** `DEPLOY_SSH_KEY`. Nó chỉ dùng được khi cổng 22 mở cho IP của kẻ tấn công, và chỉ chạy được hai lệnh trên. Tuy nhiên `load-images` nạp được image tuỳ ý, nên key này gần tương đương quyền Docker; bảo vệ nó như secret production.
- **Role sửa được mọi cổng của SG**, không chỉ 22: IAM không có điều kiện theo cổng. Muốn lạm dụng phải chạy được workflow trên `main`, nên branch protection là lớp bảo vệ thật.
- **Rule có thể tồn tại lâu hơn dự kiến** nếu runner chết trước bước đóng, tới lần deploy sau.
- **Chưa bật branch protection thì ai push được `main` đều deploy được.** `deploy.yml` tự chạy CI trước nên code đỏ vẫn không lên.
- **Mỗi deploy chuyển cả image** (thường dưới 200 MB sau nén), không có registry để tải theo layer.

## Xử lý khi sự cố

- **Bước `configure-aws-credentials` lỗi:** sai `AWS_ROLE_ARN`, hoặc trust policy không khớp `sub`. Xem CloudTrail hoặc so lại với `infra/aws/policies/github-deploy-trust.json`.
- **SSH timeout:** bước mở cổng chưa chạy, hoặc sai `EC2_HOST`. `Host key verification failed`: cập nhật `EC2_KNOWN_HOSTS`.
- **Còn rule `gha-deploy` trên SG:** xoá tay trong Console; lần deploy sau cũng tự xoá.
- **Lộ `DEPLOY_SSH_KEY`:** xoá dòng `shopfast-deploy` trong `authorized_keys`, xoá rule `gha-deploy`, tạo key mới theo `infra/aws/README.md`.
- **GitHub sập nhưng cần deploy gấp:** SSH bằng IP quản trị, `git pull`, `./infra/scripts/deploy.sh` (build tại chỗ).
