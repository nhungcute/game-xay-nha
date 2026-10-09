# API server. Build context = repository root.
FROM node:22.20.0-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @xay-nha/api build

FROM node:22.20.0-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 WORLDS_DIR=/app/worlds MIGRATIONS_DIR=/app/migrations
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/migrations ./migrations
COPY apps/web/public/worlds ./worlds
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "--enable-source-maps", "dist/server.js"]
