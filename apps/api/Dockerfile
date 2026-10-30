# syntax=docker/dockerfile:1
# Image API cho môi trường dev (build context = gốc repo).
# Bản dev giữ devDependencies để chạy được seed trong container; image production
# tối giản (prune devDeps, chỉ copy engine cần thiết) sẽ làm ở phần CI/CD.

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

FROM base AS runtime
ENV PORT=3000
# Không --chown: user node chỉ cần quyền đọc; chown cả node_modules làm build rất chậm.
COPY --from=build /app /app
WORKDIR /app/apps/api
# Thư mục hoá đơn PDF (volume `invoices`); volume mới nhận quyền sở hữu từ thư mục này.
RUN mkdir -p /data/invoices && chown node:node /data/invoices
USER node
EXPOSE 3000
# Áp migration rồi mới khởi động; migration lỗi thì container dừng, healthcheck không đạt.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
