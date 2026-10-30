# 构建阶段：无需 Rust（wasm 产物已提交）
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY web/package.json web/pnpm-lock.yaml ./web/
RUN pnpm --dir web install --frozen-lockfile
COPY web ./web
RUN pnpm --dir web build:only

# 运行阶段
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
