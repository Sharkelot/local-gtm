FROM node:24.18.0-bookworm-slim AS base
WORKDIR /app
RUN corepack enable \
  && apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/platform-worker/package.json apps/platform-worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/fixtures/package.json packages/fixtures/package.json
RUN pnpm install --frozen-lockfile
COPY apps/platform-worker apps/platform-worker
COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY packages/db packages/db
COPY packages/fixtures packages/fixtures
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN pnpm --filter @local-gtm/db db:generate \
  && pnpm --filter @local-gtm/db build \
  && pnpm --filter @local-gtm/platform-worker build
CMD ["pnpm", "--filter", "@local-gtm/platform-worker", "exec", "tsx", "src/index.ts"]
