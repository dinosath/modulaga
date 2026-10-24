FROM node:24-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY workspace-config ./workspace-config
RUN pnpm install --frozen-lockfile
ARG CONTENT_TYPES_PUBLIC_URL=https://apps.example.com/content-types/0.1.0/
RUN CONTENT_TYPES_PUBLIC_URL="$CONTENT_TYPES_PUBLIC_URL" pnpm --filter @modulaga/content-types build

FROM nginx:1.29-alpine
COPY apps/content-types/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/content-types/dist /usr/share/nginx/html
EXPOSE 80
