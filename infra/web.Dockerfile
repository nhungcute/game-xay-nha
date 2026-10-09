# Web client. Build context = repository root. VITE_OFFLINE=1 builds the offline-only client.
FROM node:22.20.0-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile
ARG VITE_OFFLINE=0
ENV VITE_OFFLINE=$VITE_OFFLINE
RUN pnpm --filter @xay-nha/web build

FROM nginx:1.29.2-alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/health || exit 1
