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

## Cấu hình & secret

- **Cấm hardcode secret** (mật khẩu, khoá API, JWT secret, connection string) trong mã nguồn, Dockerfile, compose hay file pipeline.
- Mọi cấu hình đọc qua `ConfigService` của `@nestjs/config`, không đọc `process.env` trực tiếp trong mã ứng dụng.
- Biến mới phải được thêm vào schema Joi `apps/api/src/config/env.validation.ts` và `.env.example`. Ứng dụng fail-fast khi thiếu/sai biến.
- `.env` bị gitignore; chỉ commit `.env.example` với giá trị giả.

## Kiểm thử

- Mỗi tính năng phải có **unit test cho service** (`*.service.spec.ts`, mock repository).
- Mục tiêu coverage tầng service **≥ 60%** (ngưỡng cấu hình trong `apps/api/package.json` → `jest.coverageThreshold`; `test:cov` thất bại nếu không đạt).
- Endpoint quan trọng có e2e test trong `apps/api/test/*.e2e-spec.ts`, tạo app bằng `createTestApp()` (`test/create-test-app.ts`).
- E2E chạy với Postgres + Redis thật (`TEST_DATABASE_URL`, `TEST_REDIS_URL` trong `.env`, DB tên `*_test`) – cần `docker compose up -d postgres redis`. Global setup áp migration rồi TRUNCATE DB test; unit test không cần DB.

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
