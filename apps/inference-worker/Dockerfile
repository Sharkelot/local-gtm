FROM node:26.13.1-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9 AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/inference-worker/package.json apps/inference-worker/package.json
RUN npm install --global corepack@0.36.0 \
  && corepack enable \
  && corepack prepare pnpm@10.15.0 --activate \
  && pnpm install --frozen-lockfile --filter @local-gtm/inference-worker...
COPY apps/inference-worker apps/inference-worker
RUN pnpm --filter @local-gtm/inference-worker build

FROM node:26.13.1-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/inference-worker/dist ./dist
COPY --from=build /app/apps/inference-worker/node_modules ./node_modules
USER node
CMD ["node", "dist/index.js"]
