FROM node:24.18.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/fixtures/package.json packages/fixtures/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
COPY . .
RUN pnpm --filter @local-gtm/db db:generate \
  && pnpm --filter @local-gtm/db build \
  && pnpm --filter @local-gtm/web build

FROM node:24.18.0-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 app
COPY --from=build --chown=app:app /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /workspace/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
