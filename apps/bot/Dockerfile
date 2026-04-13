# Stage 1: Build the workspace
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /workspace

# Copy workspace manifests first for better layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/bot/package.json apps/bot/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared packages/shared
COPY apps/bot apps/bot

# Build shared first, then bot
RUN pnpm --filter @dca/shared build
RUN pnpm --filter @dca/bot build

# Use pnpm deploy to extract a self-contained app dir with prod deps
RUN pnpm deploy --filter @dca/bot --prod --legacy /deploy

# Stage 2: Production runner
FROM node:22-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /deploy/dist ./dist
COPY --from=builder /deploy/package.json ./
COPY --from=builder /workspace/apps/bot/drizzle ./drizzle

USER node
CMD ["node", "dist/index.js"]
