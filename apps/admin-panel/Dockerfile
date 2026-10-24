FROM node:24-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY workspace-config ./workspace-config
ARG ADMIN_PANEL_PUBLIC_URL=https://apps.example.com/admin-panel/0.1.0/
ENV ADMIN_PANEL_PUBLIC_URL=${ADMIN_PANEL_PUBLIC_URL}
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @modulaga/admin-panel build

FROM nginx:1.29-alpine
COPY apps/admin-panel/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/admin-panel/runtime-config.js.template /etc/nginx/templates/runtime-config.js.template
COPY --from=builder /repo/apps/admin-panel/dist /usr/share/nginx/html
ENV NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/templates NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
EXPOSE 80
