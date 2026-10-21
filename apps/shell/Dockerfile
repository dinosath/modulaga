FROM node:24-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY workspace-config ./workspace-config
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @modulaga/shell build

FROM nginx:1.29-alpine
COPY apps/shell/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/shell/runtime-config.js.template /etc/nginx/templates/runtime-config.js.template
COPY --from=builder /repo/apps/shell/dist /usr/share/nginx/html
ENV NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/templates NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
EXPOSE 80
