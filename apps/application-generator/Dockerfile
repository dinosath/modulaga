FROM node:24-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY workspace-config ./workspace-config
RUN pnpm install --frozen-lockfile
ARG APPLICATION_GENERATOR_PUBLIC_URL=https://apps.example.com/application-generator/0.1.0/
RUN APPLICATION_GENERATOR_PUBLIC_URL="$APPLICATION_GENERATOR_PUBLIC_URL" pnpm --filter @modulaga/application-generator build

FROM nginx:1.29-alpine
COPY apps/application-generator/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/application-generator/runtime-config.js.template /etc/nginx/templates/runtime-config.js.template
COPY --from=builder /repo/apps/application-generator/dist /usr/share/nginx/html
ENV NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/templates NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
EXPOSE 80
