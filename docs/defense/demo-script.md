# Kịch bản demo

Thời lượng 3 phút trên sân khấu. Pipeline mất vài phút, nên push trước khi bắt đầu thuyết trình rồi quay lại xem kết quả.

## Chuẩn bị trước buổi bảo vệ

```bash
# Trên máy bạn, đặt biến dùng cho toàn bộ kịch bản
export HOST=https://shopfast-ntd.id.vn
# Lấy trên server: grep SEED_USER_PASSWORD ~/shopfast/infra/.env
export PASS='<SEED_USER_PASSWORD>'
```

Kiểm tra trước:

- [ ] `curl -s $HOST/health` trả `"status":"ok"`.
- [ ] Đăng nhập được `customer13`, `warehouse01`, `support01`, `admin01` (đuôi `@shopfast.local`). **Không dùng `customer01`: tài khoản này không có đơn nào.**
- [ ] `customer13` còn một đơn `PAID` (mục 2) và một đơn `PENDING_PAYMENT` (mục 4). Dùng hết thì đổi sang `customer10`, `customer06` hoặc `customer08` và xem đơn còn lại.
- [ ] LLM đã bật trên production (Gemini). Thử một lượt trước buổi bảo vệ để chắc key còn hạn mức.
- [ ] Hai trình duyệt, hoặc một cửa sổ thường và một cửa sổ ẩn danh.
- [ ] Có video dự phòng, phòng khi mạng hội trường lỗi.
- [ ] Mở cổng 22 cho IP hiện tại nếu cần SSH từ hội trường (mục 6).

## 1. Pipeline deploy

Nhánh `main` có branch protection nên phải qua PR. Thay đổi nhỏ, ít rủi ro: một dòng trong README.

```bash
git checkout main && git pull
git checkout -b demo/pipeline
echo "<!-- demo $(date +%F) -->" >> README.md
git commit -am "Demo pipeline"
git push -u origin demo/pipeline
gh pr create --fill
gh pr checks --watch
gh pr merge --merge --delete-branch
gh run watch "$(gh run list --workflow Deploy --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Kiểm tra:

```bash
git rev-parse origin/main
curl -s $HOST/health/live
```

`commit` phải bằng SHA của `main`. Nói: "GitHub không vào được EC2. Máy tự thấy tag `production` đổi và kéo bản mới; Nginx chỉ đổi traffic sau khi màu mới healthy, lỗi sau khi đổi thì tự rollback".

**Dự phòng:** mở lần chạy Deploy thành công gần nhất ở tab Actions.

## 2. Theo dõi đơn realtime ở hai trình duyệt

1. Trình duyệt A: đăng nhập `customer13@shopfast.local`, vào **Đơn hàng**, mở đơn `Đã thanh toán` (`/don-hang/<id>`).
2. Trình duyệt B: đăng nhập `warehouse01@shopfast.local`, vào **Xử lý đơn kho** (`/quan-tri/kho/don-hang`), chuyển trạng thái đúng đơn đó.
3. Trình duyệt A đổi trạng thái ngay, không tải lại trang (đo trên production: 233 ms).

Nói: "Emit vào room của đơn, chỉ sau khi DB commit".

## 3. Spam login để thấy 429

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "$i: %{http_code}\n" -X POST "$HOST/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"khong-ton-tai@shopfast.local","password":"sai-mat-khau"}'
done
```

Kỳ vọng (đã chạy trên production): lần 1–4 trả 401; lần 5 trả 429 `LOGIN_LOCKED` vì khoá theo email; từ lần 11 trả 429 `TOO_MANY_REQUESTS` vì hạn mức 10 lần/60 giây theo IP. Xem header `Retry-After`:

```bash
curl -si -X POST "$HOST/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"khong-ton-tai@shopfast.local","password":"sai-mat-khau"}' | grep -iE '^HTTP|retry-after'
```

Lưu ý: IP của bạn bị giới hạn 60 giây, chạy mục này sau cùng trong các mục cần đăng nhập, hoặc đăng nhập sẵn trước đó. Không dùng email thật của tài khoản demo.

## 4. Agent tra đơn và đề xuất huỷ, nhân viên xác nhận

Cần LLM đã bật. Làm trên giao diện:

1. Đăng nhập `customer13`, vào **Hỗ trợ**, tạo ticket: "Tôi đặt nhầm, muốn huỷ đơn `<mã đơn>`" (đơn `Chờ thanh toán`).
2. Đăng nhập `support01`, vào **Bàn làm việc CSKH** (`/quan-tri/cskh/ticket`), mở ticket, gọi trợ lý.
3. Trợ lý gọi `getOrderStatus`, rồi `proposeCancelOrder`. Lượt này mất khoảng 30 giây, nên nói phần giải thích trong lúc chờ. Đơn **chưa** bị huỷ, chỉ có một đề xuất chờ xác nhận.
4. Nhân viên bấm xác nhận. Đơn chuyển trạng thái, tồn kho được hoàn.

Nói: "Model không có tool ghi. Thao tác thật chỉ chạy ở `PendingActionsService.confirm`, có compare-and-set và kiểm lại điều kiện".

**Dự phòng:** chiếu video. Nếu LLM lỗi hoặc hết hạn mức, API trả 503 `AI_UNAVAILABLE`, dùng chính lỗi này để giới thiệu suy giảm có kiểm soát.

## 5. Bull Board

1. Đăng nhập `admin01`, vào **Giám sát hệ thống** (`/quan-tri/he-thong`).
2. Bấm mở Bull Board (trang `/admin/queues`).
3. Chỉ queue `email`, `invoice`, `inventory-sync`, `ticket-classify`, `dead-letter`. Job vừa sinh nằm ở `inventory-sync` (huỷ đơn mục 4) và `ticket-classify` (ticket mục 4). Chuyển `PAID → PROCESSING` ở mục 2 không sinh job.

Nói: "jobId cố định theo đơn nên không đẩy trùng; hết lượt thử thì vào dead-letter".

## 6. Tắt Redis, hệ thống vẫn chạy

Cần SSH từ IP được phép.

```bash
ssh -i <key.pem> ubuntu@<ELASTIC_IP>
cd ~/shopfast/infra
docker compose -f docker-compose.prod.yml stop redis
```

Ở máy bạn:

```bash
curl -s $HOST/health
curl -s -o /dev/null -w '%{http_code}\n' "$HOST/api/products?limit=1"
```

Kỳ vọng: `/health` trả 200 `"status":"degraded"`, `redis: down`; danh sách sản phẩm vẫn 200, đọc từ DB. Rate limit cho qua, OTP trả 503 tiếng Việt, job không đẩy được cho tới khi Redis trở lại.

Bật lại ngay:

```bash
docker compose -f docker-compose.prod.yml start redis
curl -s https://shopfast-ntd.id.vn/health
```

## Sau demo

```bash
git checkout main && git pull
git branch -d demo/pipeline
```

## Trạng thái kiểm thử của kịch bản

Đã chạy trên production ngày 2026-11-01, trừ khi ghi khác.

| Mục           | Trạng thái                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. Pipeline   | Đạt qua PR #2, #3. Chưa chạy đúng chuỗi lệnh `gh` của mục này                                                                   |
| 2. Realtime   | API và Socket.IO đạt: nhận `order:updated` sau 233 ms; khách khác bị từ chối; token sai bị chặn. Chưa diễn trên hai trình duyệt |
| 3. 429        | Đạt                                                                                                                             |
| 4. Agent      | API đạt: đề xuất huỷ, đơn chưa đổi, xác nhận thì huỷ và hoàn kho, xác nhận lần 2 trả 409. Chưa diễn trên giao diện              |
| 5. Bull Board | API đạt: admin 200, không đăng nhập 401, khách 403. Chưa mở trên trình duyệt                                                    |
| 6. Tắt Redis  | Đạt                                                                                                                             |

## Lưu ý về email

Tài khoản `@shopfast.local` không có hộp thư thật. Production đặt `MAIL_REDIRECT_TO=dunghmqd@gmail.com`, nên thư đặt đơn, nhắc thanh toán và báo cáo ngày đều về Gmail đó, tiêu đề ghi người nhận gốc. Đổi trạng thái và huỷ đơn không gửi email. OTP chỉ ghi vào log. Muốn demo email: đặt đơn mới rồi mở Gmail.
