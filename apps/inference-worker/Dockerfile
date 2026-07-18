FROM node:24.11.1-bookworm-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/inference-worker/package.json apps/inference-worker/package.json
RUN corepack enable && pnpm install --frozen-lockfile --filter @local-gtm/inference-worker...
COPY apps/inference-worker apps/inference-worker
RUN pnpm --filter @local-gtm/inference-worker build

FROM node:24.11.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/inference-worker/dist ./dist
COPY --from=build /app/apps/inference-worker/node_modules ./node_modules
USER node
CMD ["node", "dist/index.js"]
