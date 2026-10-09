# syntax=docker/dockerfile:1
# AliVocab in one image: the API serves the built web app on one port. See docs/deploy.md.

ARG NODE_VERSION=24

# ── Build: install, compile web + API, then keep only the API's runtime dependencies ──
FROM node:${NODE_VERSION}-bookworm-slim AS build
# For native modules (better-sqlite3) when no prebuilt binary matches the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.33.0
WORKDIR /repo

# Manifests first, so code changes don't reinstall dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# The API bundle includes the workspace packages; this keeps its external dependencies only.
RUN pnpm --filter @alivocab/api deploy --prod --legacy /out \
  && rm -rf /out/src /out/tsconfig.json /out/tsup.config.ts

# ── Runtime ──
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production \
  PORT=3180 \
  DATABASE_URL=/data/alivocab.db \
  MEDIA_DIR=/data/media \
  BACKUP_DIR=/data/backups \
  STATIC_DIR=/app/public \
  APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/web/dist ./public
# Database, pictures, audio and backups live on the /data volume.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3180
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3180)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
