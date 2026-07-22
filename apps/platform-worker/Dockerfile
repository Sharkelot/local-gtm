FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable \
  && apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/platform-worker/package.json apps/platform-worker/tsconfig.build.json apps/platform-worker/
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
RUN node -e 'const fs = require("fs"); for (const name of ["contracts", "domain", "fixtures"]) { fs.writeFileSync(`packages/${name}/tsconfig.build.json`, `${JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: false, rootDir: "src", outDir: "dist" }, include: ["src/**/*.ts"], exclude: ["test/**/*.ts"] }, null, 2)}\n`); }' \
  && pnpm --dir packages/contracts exec tsc -p tsconfig.build.json \
  && pnpm --dir packages/domain exec tsc -p tsconfig.build.json \
  && pnpm --dir packages/fixtures exec tsc -p tsconfig.build.json \
  && node -e 'const fs = require("fs"); for (const name of ["contracts", "domain", "fixtures"]) { const path = `packages/${name}/package.json`; const pkg = JSON.parse(fs.readFileSync(path, "utf8")); pkg.exports["."].default = "./dist/index.js"; fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`); fs.rmSync(`packages/${name}/tsconfig.build.json`); }' \
  && pnpm --filter @local-gtm/db db:generate \
  && pnpm --filter @local-gtm/db build \
  && pnpm --filter @local-gtm/platform-worker build \
  && pnpm --filter @local-gtm/platform-worker deploy --prod /prod/platform-worker \
  && for target in /prod/platform-worker/node_modules/.pnpm/@prisma+client@*/node_modules; do \
    cp -a /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma "$target/"; \
    cp -a /app/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/. "$target/@prisma/client/"; \
  done \
  && rm -rf /prod/platform-worker/src /prod/platform-worker/test \
  && rm -f /prod/platform-worker/Dockerfile \
    /prod/platform-worker/tsconfig.build.json \
    /prod/platform-worker/tsconfig.json \
    /prod/platform-worker/vitest.config.ts

FROM node:24.18.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /prod/platform-worker ./
USER node
CMD ["node", "dist/index.js"]
