# CLAUDE.md – Quy ước dự án ShopFast

Backend thương mại điện tử (Defense Case Study 6, Module 6). Monorepo pnpm workspace.

```
apps/api   NestJS 10 – API, realtime, background jobs
apps/web   React 18 + Vite + Tailwind – UI demo tối thiểu
infra/     Docker Compose, Nginx, script sao lưu, cấu hình triển khai
docs/adr/  Architecture Decision Records
```

## Stack cố định (không tự ý thay)

| Thành phần      | Phiên bản                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------- |
| Node.js         | 20 LTS (`.nvmrc`), TypeScript strict                                                          |
| Framework       | NestJS 10                                                                                     |
| Database        | PostgreSQL 16                                                                                 |
| Cache / queue   | Redis 7                                                                                       |
| ORM             | **Prisma 6** – lý do tại [docs/adr/0001-chon-orm-prisma.md](docs/adr/0001-chon-orm-prisma.md) |
| Package manager | pnpm 10 (workspace) – pnpm 11 cần Node ≥ 22 nên không dùng                                    |

Thêm thư viện mới có ảnh hưởng kiến trúc (queue, cache, auth, realtime…) phải kèm ADR.

## Kiến trúc

Mỗi module trong `apps/api/src/modules/<tên>/` tách:

- `<tên>.controller.ts` – nhận request, validate DTO, gọi service, trả kết quả. **Không chứa logic nghiệp vụ.**
- `<tên>.service.ts` – logic nghiệp vụ. **Không inject `PrismaService`**, chỉ inject repository.
- `<tên>.repository.ts` – nơi duy nhất truy cập DB qua `PrismaService` (`src/database/`).
- `dto/` – DTO vào/ra, validate bằng class-validator (lỗi trả `VALIDATION_FAILED` tiếng Việt).

Prisma: schema ở `apps/api/prisma/schema.prisma`. Migration sinh xong phải review; ràng buộc CHECK thêm tay trong SQL (ADR-0002) không được làm mất. Tiền lưu `Int` theo đồng (VND).

Lỗi nghiệp vụ: ném `AppException(status, code, thôngĐiệpTiếngViệt)` (`src/common/exceptions/app.exception.ts`). `HttpExceptionFilter` chuẩn hoá mọi lỗi thành `{ statusCode, code, message, path, timestamp }`.

## Xác thực & phân quyền (ADR-0003)

- `JwtAuthGuard` + `RolesGuard` là guard **toàn cục, mặc định từ chối**: endpoint mới tự động yêu cầu đăng nhập.
- Endpoint công khai phải ghi rõ `@Public()`; giới hạn vai trò bằng `@Roles(Role.ADMIN, ...)`; lấy user bằng `@CurrentUser()` (`src/modules/auth/decorators/`).
- Không bao giờ trả `passwordHash` ra ngoài – dùng `PublicUser` / `toPublicUser` của `users.repository.ts`.
- Kiểm token ở nơi khác (WebSocket F02…) dùng `TokenService.verifyAccessToken` – không tự viết lại.
- Redis dùng qua token `REDIS_CLIENT` (`src/database/redis.module.ts`); client fail-fast, nơi gọi phải bắt lỗi và suy giảm có kiểm soát (ví dụ `OtpService` trả 503).
- Id số trên URL parse bằng `ParseIdPipe` (`src/common/pipes/parse-id.pipe.ts`), không dùng `ParseIntPipe`.

## Domain event (ADR-0004)

- Phát bằng `EventEmitter2` (`@nestjs/event-emitter`), tên `<aggregate>.<động từ quá khứ>`, hằng số + class payload trong `modules/<module>/events/` (ví dụ `PRODUCT_UPDATED` trong `modules/catalog/events/product-updated.event.ts`).
- **Chỉ phát sau khi DB commit** và chỉ khi có thay đổi thật; payload mang giá trị cũ/mới để listener không phải đọc lại DB.
- Listener: `@OnEvent(PRODUCT_UPDATED, { async: true, suppressErrors: true })`, tự try/catch + log; việc nặng thì đẩy sang queue (F05). Lỗi listener không được làm hỏng request gốc.
- Cập nhật tồn kho dùng một câu `UPDATE` nguyên tử có điều kiện (`CatalogRepository.applyPatch`), không dùng interactive transaction SELECT-rồi-UPDATE (cạn connection pool khi tranh chấp).

## Tồn kho, đặt hàng & transaction (ADR-0005)

- Trừ kho **chỉ** bằng `UPDATE products SET stock = stock - $qty WHERE id = $id AND stock >= $qty` và kiểm số dòng bị ảnh hưởng; không đọc-kiểm-ghi trong app, không giữ tồn kho ở Redis.
- Nhiều dòng trong một transaction: khoá/trừ **theo `productId` tăng dần** để không deadlock.
- Interactive transaction (`prisma.$transaction(async tx => …)`) phải ngắn, không gọi dịch vụ ngoài, đặt `maxWait`/`timeout` rõ ràng; `P2028` → 503 tiếng Việt.
- Muốn rollback từ logic nghiệp vụ: ném lỗi nội bộ trong transaction, bắt ngay bên ngoài và **repository trả union kết quả** (`{ status: 'created' | 'insufficient_stock' | … }`); service ánh xạ union sang `AppException`.
- `POST /orders` hỗ trợ `Idempotency-Key` (unique theo user, chèn đơn trước khi trừ kho). Endpoint ghi mới có rủi ro bấm trùng nên theo cùng cách.
- Lỗi có dữ liệu cho client: `AppException(status, code, message, details)` → body có `details`.

## Trạng thái đơn (ADR-0006)

- Luật chuyển trạng thái **chỉ** nằm trong `ORDER_TRANSITIONS` (`modules/orders/order-status.machine.ts`); kiểm bằng `assertTransition` (409 tiếng Việt).
- Mọi thay đổi `orders.status` (kể cả job F05) phải đi qua `OrdersService.changeStatus` → compare-and-set `WHERE status = :from`, ghi `order_status_history` (chỉ INSERT), hoàn kho khi huỷ, phát `order.status_changed` sau commit. Không `UPDATE orders SET status` trực tiếp.

## Cache (ADR-0007)

- Đọc catalog qua `CatalogCacheService` → `CacheService.getOrLoad` (`modules/cache/`): cache-aside, khoá có version, lock `SET NX PX`, TTL jitter, cache giá trị rỗng. Cache mới dùng lại `CacheService`, không gọi Redis trực tiếp.
- **Mọi thay đổi giá/giá gốc/ảnh/tồn kho phải phát `product.updated`**, nếu không cache sẽ cũ. Seed và SQL tay phải tự xoá cache (`prisma/clear-cache.ts`).
- `CatalogCacheListener` chạy **đồng bộ** (không `async: true`) và không có `await` trước lệnh Redis, để lệnh invalidation được gửi trước khi trả response.
- Redis chỉ là lớp tăng tốc: lỗi/timeout (`REDIS_COMMAND_TIMEOUT_MS`) → log cảnh báo, đọc DB, không trả lỗi cho khách.

## Rate limit & khoá đăng nhập (ADR-0008)

- `AppThrottlerGuard` (`modules/rate-limit/`) là guard toàn cục, đếm trên Redis: tracker `user:<id>` khi đã đăng nhập, `ip:<req.ip>` khi chưa. `RateLimitModule` phải import **sau** `AuthModule` để guard chạy sau `JwtAuthGuard`.
- Hạn mức chung đếm gộp toàn API. Endpoint nhạy cảm (đăng nhập, gửi OTP, đặt đơn khuyến mãi…) gắn thêm `@RateLimit('<policy>')`; policy mới khai báo trong `rate-limit.policies.ts` + biến env `RATE_LIMIT_*` dạng `<số>/<giây>`.
- IP thật lấy qua `X-Forwarded-For` nhờ `TRUST_PROXY` = đúng số proxy đứng trước API (sau Nginx: `1`). Không tự đọc header `X-Forwarded-For`, dùng `req.ip`.
- Lỗi 429 tự viết: `AppException(429, code, thôngĐiệp, { retryAfterSeconds })`. `HttpExceptionFilter` đặt `Retry-After` từ đó; thông điệp dùng `formatWait` (`common/messages/vi.ts`).
- Đăng nhập sai bị đếm theo **email** (`LoginAttemptsService`), không theo IP; khoá kiểm trước bcrypt. Redis lỗi → rate limit và khoá cho qua + log cảnh báo.

## Background jobs (ADR-0009)

- BullMQ (`modules/jobs/`): queue `email`, `invoice`, `inventory-sync`, `dead-letter`; số lần thử + backoff exponential từng queue trong `queues.ts`. Job đẩy từ `OrderJobsListener` (event sau commit), API không chờ.
- **jobId cố định** `<loại job>-<orderId>` (`orderJobId`, không dùng `:`); payload chỉ mang id, worker đọc lại DB và **kiểm lại trạng thái** khi chạy.
- Email gửi qua `MailSender` và **phải** đi qua `EmailJobsService.deliverOnce` (giành quyền trong `email_deliveries` trước khi gửi). Email loại mới = thêm vào `EmailJob`, không gửi thẳng.
- Processor chỉ định tuyến job → service, kế thừa `ReportingWorkerHost` (dead-letter + log lỗi worker). Lỗi thử lại vô ích → `UnrecoverableError`.
- Kết nối Redis của BullMQ riêng (`queue-connection.ts`), không dùng `REDIS_CLIENT`. `QUEUE_WORKERS_ENABLED=false` → chỉ đẩy job (test tắt sẵn trong `setup-env.ts`; `jobs.e2e-spec.ts` tự bật).
- Bull Board `/admin/queues` (ngoài `/api`) tự kiểm ADMIN bằng `TokenService`; Mailpit UI ở dev: `http://127.0.0.1:8025`.

## Realtime (ADR-0010)

- Socket.IO tại `/socket.io` (ngoài `/api`), **chỉ transport websocket**; `RedisIoAdapter` (`modules/realtime/`) đồng bộ room giữa các instance qua kết nối Redis riêng, không dùng `REDIS_CLIENT`.
- Xác thực **tại handshake** (`auth.token` hoặc `Authorization: Bearer`) bằng `TokenService.verifyAccessToken`; token sai → `connect_error` `{ code, message }` tiếng Việt; hết hạn → server ngắt.
- Gateway là tầng controller; kiểm quyền nằm ở `OrderTrackingService`, dùng lại `OrdersService.findOne` (chủ đơn hoặc nhân viên; không thuộc → `ORDER_NOT_FOUND`). Ack trả `{ ok, ... }`, không ném lỗi trong handler.
- Emit **chỉ vào room** (`orderRoom(id)`), từ listener của domain event sau commit; payload không mang dữ liệu nội bộ (`note`, `changedBy`).
- Guard toàn cục (`JwtAuthGuard`, `RolesGuard`, `AppThrottlerGuard`) bỏ qua context không phải `http`; guard mới cũng phải làm vậy.
- Hợp đồng sự kiện khai báo ở `realtime.events.ts` và `apps/web/src/realtime/order-socket.ts` – đổi cả hai. E2E nhiều instance trong một process cần `EventEmitter2` riêng cho app thứ hai (`realtime.e2e-spec.ts`).

## Support & trợ lý AI (ADR-0011)

- LLM chỉ gọi qua token `LLM_PROVIDER` (`modules/llm/`: `anthropic` | `openai` | `google` | `disabled`, mặc định `disabled`; `google` = Gemini qua endpoint tương thích OpenAI, dùng chung adapter `openai`); không import SDK provider ở nơi khác. Test thay bằng `ScriptedLlmProvider` (`test/scripted-llm.provider.ts`), không bao giờ gọi LLM thật.
- **Tool của agent chỉ đọc hoặc tạo `PendingAction`.** Thao tác ghi thật chỉ chạy trong `PendingActionsService.confirm` (endpoint nhân viên bấm), giành quyền bằng compare-and-set `PENDING → EXECUTING` và kiểm lại điều kiện lúc xác nhận. Thao tác ghi mới = thêm `PendingActionType` + nhánh trong `confirm`, không thêm tool ghi trực tiếp.
- Tool gọi service nghiệp vụ (cùng luật quyền như HTTP), lỗi trả cho model dạng `isError` (không ném ra request). Bắt lỗi trong `try` thì phải `return await`.
- Output của LLM luôn kiểm lại bằng code: enum phân loại (`parseCategory`), câu trả lời cuối (`parseFinalAnswer`), grounding (`agent/grounding.ts` – mã đơn/SKU/trạng thái/tồn kho phải có trong kết quả tool của lượt đó).
- Nội dung khách viết đưa vào prompt trong thẻ (`<ticket>`, `<ticket_context>`) và ghi rõ là dữ liệu, không phải chỉ dẫn.
- `LlmError` → 503 `AI_UNAVAILABLE` tiếng Việt, không lộ provider/thông điệp gốc. Phân loại chạy ở queue `ticket-classify`; lần thử cuối lỗi → `KHAC` (FALLBACK), gán bằng `WHERE category IS NULL`.

## Health & tắt êm (ADR-0012)

- `GET /health` (readiness: DB + Redis) và `GET /health/live` (liveness) nằm **ngoài `/api`**; healthcheck Docker dùng `/health`. Phụ thuộc không bắt buộc (Redis…) lỗi → `degraded` 200, không 503; chỉ phụ thuộc bắt buộc (DB) lỗi mới 503.
- Đóng tài nguyên (kết nối, client) ở **`onApplicationShutdown`**, không ở `onModuleDestroy` (hook đó chạy trước khi Nest ngừng nhận request).
- Worker BullMQ mới phải thêm vào `processors` của `WorkersBootstrapService` để được đóng sau drain (chờ job đang chạy). Việc chạy lâu hơn `SHUTDOWN_TIMEOUT_MS` phải chia nhỏ hoặc idempotent để chạy lại.
- Dockerfile phải `exec` tiến trình node (SIGTERM tới được Node); compose giữ `init: true` và `stop_grace_period` lớn hơn `SHUTDOWN_TIMEOUT_MS`.

## Triển khai production (ADR-0013 → 0016)

- Máy chủ chỉ có một EC2; ngoài ra chỉ dùng IAM và một S3 bucket backup, không thêm ECR/SSM. Thiết lập AWS: `infra/aws/README.md`.
- Push `main` chạy `.github/workflows/deploy.yml`: CI → build trên runner, đẩy GHCR tag full SHA → dời tag git `production` → chờ `/health/live` đúng SHA. Cron trên EC2 (`pull-deploy.sh`, cài vào `/usr/local/bin`, đổi file phải chạy lại `bootstrap-server.sh`) kéo image rồi gọi `deploy.sh <sha>`. Không có AWS key hay SSH key ở GitHub; không dùng OIDC vì Identity providers bị khoá theo gói tài khoản.
- `deploy.sh`: backup nếu có migration mới, migrate, bật màu còn lại, chờ healthy, đổi upstream, kiểm tra qua Nginx (`/health/live` đúng commit), drain, dừng màu cũ, ghi `infra/.deploy/last_good_sha`. Sau khi đổi mà lỗi thì tự gọi `rollback.sh` (dùng image có sẵn, không migrate).
- Backup: `backup.sh`, cron hằng ngày; `restore.sh` chỉ khôi phục vào DB mới `shopfast_restore_*`. Diễn tập: `docs/restore-drill.md`.
- `apps/api/Dockerfile`: stage cuối `production` là mặc định, dev dùng `target: dev`. Image không chứa secret, không tự migrate (service `migrate`).
- Secret nằm ở `infra/.env` trên server (`chmod 600`, gitignore, sinh bằng `infra/scripts/init-env.sh`), **không bao giờ commit**; mẫu ở `infra/.env.example`.
- Mạng `backend` là `internal: true`; chỉ nginx có `ports`.
- Đổi màu bằng `infra/scripts/switch-upstream.sh`, không sửa tay `active.conf`. Migration phải tương thích ngược vì hai màu chạy song song.

## Frontend (apps/web)

- Design system "Modern Vietnamese Retail Flow" (`apps/web/design/DESIGN.md`, bản export Google Stitch – chỉ tham chiếu, không import). Token màu/font/bo góc/shadow nằm **duy nhất** ở `apps/web/tailwind.config.js`; component chỉ dùng tên token (`bg-primary-container`, `text-on-surface-variant`, `shadow-card`…), **không** mã hex hay màu mặc định Tailwind (`slate-*`, `red-*`…). Bo góc theo DESIGN.md (config Stitch đặt sai `full`).
- Component dùng chung ở `src/components/ui` (import từ `components/ui`); icon = Material Symbols qua `<Icon name="…" />`. File `.tsx` chỉ export component (luật react-refresh) – hook/hằng/helper để file `.ts` riêng.
- Gọi API **chỉ** qua `api/client.ts` (`api.get/post…`) và đọc dữ liệu server bằng TanStack Query; không `fetch` thẳng. Client tự gắn token, refresh **single-flight** khi 401 (refresh token xoay vòng, dùng một lần), chuẩn hoá lỗi thành `ApiError { status, code, message, details }`, 429 → `rateLimitStore` → `RateLimitBanner` đếm ngược theo `Retry-After`.
- Phiên (`auth/session.ts`) lưu localStorage, vai trò đọc từ JWT **chỉ để điều hướng**; quyền thật do API kiểm. Đánh đổi: token đọc được nếu dính XSS – không dùng `dangerouslySetInnerHTML` với dữ liệu người dùng.
- Route nhân viên khai báo ở `router/staff-nav.ts` (menu + vai trò); guard `RequireAuth roles={…}` (chưa đăng nhập → `/dang-nhap?next=`, sai vai trò → 403). Trang nhân viên/admin mới phải `lazy()` trong `routes.tsx`, đặt **bên trong** `RequireAuth` để người không có quyền không tải chunk; ma trận quyền test ở `router/routes.test.tsx`.
- Layout nhân viên có sidebar 16rem: breakpoint Tailwind tính theo màn hình, nên bố cục nhiều cột phải tính cả phần sidebar đã chiếm (kiểm tra ở 1280px).
- Trạng thái đơn → nhãn/màu chỉ ở `ORDER_STATUS_META` (`src/orders/order-status.ts`); type `OrderStatus` dùng chung với `realtime/order-socket.ts`.
- Hiển thị tiền/thời gian qua `lib/format.ts` (`formatPrice` → `1.290.000 ₫`, giờ `Asia/Ho_Chi_Minh`).
- Trang có bộ lọc giữ state trên **URL query** (chia sẻ link, Back/Forward): parse/serialize thuần trong `<feature>/…-filters.ts` (bỏ giá trị sai, bỏ giá trị mặc định), hook `use…Filters` đọc/ghi `useSearchParams`; ví dụ mẫu `src/products/` + `pages/ProductListPage.tsx`.
- Request ghi có rủi ro bấm trùng (`POST /orders`…) gửi `Idempotency-Key` từ `newIdempotencyKey()` (`lib/idempotency.ts`), **sinh một lần cho mỗi lần đặt**: giữ key khi lỗi thử lại được (mạng, 5xx, 429, `IDEMPOTENCY_CONFLICT`), bỏ key khi thành công, lỗi nghiệp vụ hoặc dữ liệu gửi đi đổi (mẫu: `cart/usePlaceOrder.ts`).
- Test web: Vitest + Testing Library (`pnpm --filter @shopfast/web test`, cũng chạy trong `pnpm test`). File `*.test.ts(x)` cạnh code; render trang bằng `renderPage` (`src/test/render.tsx`), giả API bằng `fakeApi` + `loginAs` (`src/test/fake-api.ts`) – thay `fetch`, request vẫn đi qua `api/client.ts` thật; **không** gọi API thật. Truy vấn theo role/label (a11y), không theo class.
- Biến môi trường web có tiền tố `VITE_`, khai báo kiểu ở `src/vite-env.d.ts` và `apps/web/.env.example`. Không đặt secret ở web (mọi thứ trong bundle đều công khai).

## Tài liệu API (Swagger)

- UI tại `/docs`, JSON tại `/docs-json` (`src/swagger.ts`, bật bằng `SWAGGER_ENABLED`). Schema sinh bằng Nest CLI plugin (`nest-cli.json`) từ type + class-validator + **JSDoc**.
- DTO request/response đặt tên `*.dto.ts`, `*.query.ts`, `*.response.ts`; mỗi trường có JSDoc một dòng (thành `description`). Response trả ra ngoài phải là **class** (interface không có schema). Enum Prisma cần `@ApiProperty({ enum: X, enumName: 'X' })`.
- Controller: `@ApiTags`, JSDoc trên handler (dòng đầu = summary), `@ApiBearerAuth('bearer')` cho endpoint cần đăng nhập, `@ApiErrorResponses(...)` (`common/swagger/`) cho lỗi chuẩn.

## Cấu hình & secret

- **Cấm hardcode secret** (mật khẩu, khoá API, JWT secret, connection string) trong mã nguồn, Dockerfile, compose hay file pipeline.
- Mọi cấu hình đọc qua `ConfigService` của `@nestjs/config`, không đọc `process.env` trực tiếp trong mã ứng dụng.
- Biến mới phải được thêm vào schema Joi `apps/api/src/config/env.validation.ts` và `.env.example`. Ứng dụng fail-fast khi thiếu/sai biến.
- `.env` bị gitignore; chỉ commit `.env.example` với giá trị giả.

## Kiểm thử

- Mỗi tính năng phải có **unit test cho service** (`*.service.spec.ts`, mock repository).
- Mục tiêu coverage tầng service **≥ 60%**, chỉ đo `*.service.ts` (ngưỡng cấu hình trong `apps/api/package.json` → `jest.coverageThreshold`; `test:cov` thất bại nếu không đạt).
- Endpoint quan trọng có e2e test trong `apps/api/test/*.e2e-spec.ts`, tạo app bằng `createTestApp()` (`test/create-test-app.ts`).
- E2E chạy với Postgres + Redis thật (`TEST_DATABASE_URL`, `TEST_REDIS_URL` trong `.env`, DB tên `*_test`) – cần `docker compose up -d postgres redis`. Global setup áp migration rồi TRUNCATE DB test; unit test không cần DB.
- CI (`.github/workflows/ci.yml`) chạy trên PR vào `main` và trước mỗi deploy, không dùng secret: job `Lint`, `Unit test` (coverage API thành artifact), `E2E test`, `Docker build`. Branch protection tham chiếu theo tên job: đổi tên phải sửa cả ở đó.

## Lệnh chuẩn (chạy ở gốc repo)

```bash
pnpm install          # cài đặt + prisma generate
pnpm lint             # ESLint toàn repo (0 warning)
pnpm format:check     # Prettier
pnpm test             # unit test
pnpm test:cov         # unit test + coverage (có ngưỡng)
pnpm test:e2e         # e2e test
pnpm build            # build api + web
pnpm --filter @shopfast/api start:dev
pnpm --filter @shopfast/web dev

# Môi trường dev bằng Docker (chi tiết: README.md → Chạy cục bộ)
docker compose up -d --build                 # api + postgres + redis
docker compose exec api npx prisma db seed   # nạp dữ liệu mẫu
pnpm --filter @shopfast/api prisma:migrate   # tạo migration mới (từ host)
pnpm --filter @shopfast/api db:seed          # seed từ host
```

Trước khi báo hoàn thành một thay đổi: chạy `pnpm lint` và `pnpm test`.

## ADR

Mỗi quyết định kỹ thuật quan trọng ghi một file `docs/adr/NNNN-ten-ngan.md` theo mẫu [0000-template.md](docs/adr/0000-template.md), gồm: **Bối cảnh, Lựa chọn, Lý do, Đánh đổi, Xử lý khi sự cố**.

## Ngôn ngữ

- Thông điệp lỗi trả cho người dùng **bằng tiếng Việt** (thông điệp mặc định theo mã HTTP ở `src/common/messages/vi.ts`).
- Không trả stack trace hoặc chi tiết hạ tầng cho client; log nội bộ có thể bằng tiếng Anh.
