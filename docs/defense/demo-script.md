# Kịch bản demo

Thời lượng 3 phút trên sân khấu. Pipeline mất vài phút, nên push trước khi bắt đầu thuyết trình rồi quay lại xem kết quả.

## Chuẩn bị trước buổi bảo vệ

```bash
# Trên máy bạn, đặt biến dùng cho toàn bộ kịch bản
export HOST=https://16-178-17-65.sslip.io
# Lấy trên server: grep SEED_USER_PASSWORD ~/shopfast/infra/.env
export PASS='<SEED_USER_PASSWORD>'
```

Kiểm tra trước:

- [ ] `curl -s $HOST/health` trả `"status":"ok"`.
- [ ] Đăng nhập được `customer01`, `warehouse01`, `support01`, `admin01` (đuôi `@shopfast.local`).
- [ ] `LLM_PROVIDER` và `LLM_API_KEY` đã đặt trong `infra/.env` nếu demo agent thật. Mặc định là `disabled`, khi đó bỏ qua mục 4 và chiếu video.
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

1. Trình duyệt A: đăng nhập `customer01@shopfast.local`, vào **Đơn hàng**, mở một đơn đang xử lý (`/don-hang/<id>`).
2. Trình duyệt B: đăng nhập `warehouse01@shopfast.local`, vào **Xử lý đơn kho** (`/quan-tri/kho/don-hang`), chuyển trạng thái đúng đơn đó.
3. Trình duyệt A đổi trạng thái ngay, không tải lại trang.

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

1. Đăng nhập `customer01`, vào **Hỗ trợ**, tạo ticket: "Tôi muốn huỷ đơn `<mã đơn>`".
2. Đăng nhập `support01`, vào **Bàn làm việc CSKH** (`/quan-tri/cskh/ticket`), mở ticket, gọi trợ lý.
3. Trợ lý gọi `getOrderStatus`, rồi `proposeCancelOrder`. Đơn **chưa** bị huỷ, chỉ có một đề xuất chờ xác nhận.
4. Nhân viên bấm xác nhận. Đơn chuyển trạng thái, tồn kho được hoàn.

Nói: "Model không có tool ghi. Thao tác thật chỉ chạy ở `PendingActionsService.confirm`, có compare-and-set và kiểm lại điều kiện".

**Dự phòng:** chiếu video; nếu `LLM_PROVIDER=disabled`, API trả 503 `AI_UNAVAILABLE`, dùng chính lỗi này để giới thiệu suy giảm có kiểm soát.

## 5. Bull Board

1. Đăng nhập `admin01`, vào **Giám sát hệ thống** (`/quan-tri/he-thong`).
2. Bấm mở Bull Board (trang `/admin/queues`).
3. Chỉ queue `email`, `invoice`, `inventory-sync`, `dead-letter` và các job vừa sinh ở mục 2.

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
curl -s https://16-178-17-65.sslip.io/health
```

## Sau demo

```bash
git checkout main && git pull
git branch -d demo/pipeline
```

## Trạng thái kiểm thử của kịch bản

| Mục           | Trạng thái                                                                         |
| ------------- | ---------------------------------------------------------------------------------- |
| 1. Pipeline   | Đã chạy thật qua PR #2: 5 phút 47 giây, production đúng SHA                        |
| 2. Realtime   | Có e2e `realtime.e2e-spec.ts`; chưa thử thao tác trên hai trình duyệt ở production |
| 3. 429        | Đã chạy trên production                                                            |
| 4. Agent      | Chưa chạy, cần LLM key                                                             |
| 5. Bull Board | Có test; chưa mở trên production                                                   |
| 6. Tắt Redis  | Đã chạy trên production: `degraded` 200, sản phẩm 200, Redis bật lại thì `ok`      |
