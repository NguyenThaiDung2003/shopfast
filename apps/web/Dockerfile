# syntax=docker/dockerfile:1
# Build web ra file tĩnh (build context = gốc repo; file ignore riêng: Dockerfile.dockerignore).
# Container chạy một lần, đổ file vào volume `web_static` mà Nginx phục vụ (ADR-0013).

FROM node:20-alpine AS build
RUN npm install -g pnpm@10.34.9
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @shopfast/web...
COPY apps/web apps/web
# Mọi thứ trong bundle đều công khai: chỉ truyền cấu hình, không bao giờ truyền secret.
ARG VITE_API_BASE_URL
ARG VITE_SUPPORT_HOTLINE
ARG VITE_SUPPORT_HOTLINE_HOURS
ARG VITE_SUPPORT_EMAIL
ARG VITE_SUPPORT_CHAT_URL
ARG VITE_SUPPORT_CHAT_NAME
RUN pnpm --filter @shopfast/web build

FROM alpine:3.22 AS static
COPY --from=build /app/apps/web/dist /dist
COPY --chmod=755 apps/web/publish-static.sh /usr/local/bin/publish-static.sh
CMD ["/usr/local/bin/publish-static.sh"]
