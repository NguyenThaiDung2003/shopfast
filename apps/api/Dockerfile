# syntax=docker/dockerfile:1
# Image API (build context = gốc repo). Stage cuối `production` là mặc định;
# docker-compose.yml dev dùng `target: dev`.

FROM node:20-alpine AS base
# openssl: Prisma engine trên Alpine cần libssl. pnpm khớp với packageManager trong package.json gốc.
RUN apk add --no-cache openssl && npm install -g pnpm@10.34.9
WORKDIR /app

FROM base AS build
# Copy manifest trước để tận dụng cache layer khi chỉ sửa mã nguồn.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile --filter @shopfast/api...
COPY apps/api apps/api
RUN pnpm --filter @shopfast/api build

# Dev giữ devDependencies để chạy được seed trong container.
FROM base AS dev
ENV PORT=3000
# Không --chown: user node chỉ cần quyền đọc; chown cả node_modules làm build rất chậm.
COPY --from=build /app /app
WORKDIR /app/apps/api
# Thư mục hoá đơn PDF (volume `invoices`); volume mới nhận quyền sở hữu từ thư mục này.
RUN mkdir -p /data/invoices && chown node:node /data/invoices
USER node
EXPOSE 3000
# Áp migration rồi mới khởi động; migration lỗi thì container dừng, healthcheck không đạt.
# `exec`: node thay chỗ sh nên nhận được SIGTERM (sh không chuyển tín hiệu) – tắt êm, ADR-0012.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main"]

# Bộ node_modules chỉ có dependency production, không còn symlink tới workspace.
FROM build AS prod-deps
RUN pnpm --filter @shopfast/api --prod --legacy deploy /prod \
  && cp -r apps/api/dist /prod/dist \
  && rm -rf /prod/src /prod/test /prod/scripts /prod/coverage /prod/Dockerfile
# `pnpm deploy` không chạy postinstall: thiếu bước này @prisma/client chỉ là stub, enum = undefined.
WORKDIR /prod
RUN npx prisma generate

FROM node:20-alpine AS production
# Secret truyền vào lúc chạy qua biến môi trường (ADR-0013); image không chứa secret nào.
RUN apk add --no-cache openssl
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=prod-deps /prod ./
RUN mkdir -p /data/invoices && chown node:node /data/invoices
USER node
EXPOSE 3000
# Readiness (ADR-0012): DB lỗi hoặc đang tắt → 503 → unhealthy; Redis lỗi → 200 degraded.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
# Không tự migrate: hai màu blue-green không được đua nhau, service `migrate` chạy trước (ADR-0013).
CMD ["node", "dist/main"]
