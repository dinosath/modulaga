FROM node:24-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @modulaga/demo-react build

FROM nginx:1.29-alpine
COPY apps/demo-react/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/demo-react/dist /usr/share/nginx/html
EXPOSE 80
