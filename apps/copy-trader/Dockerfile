# Stage 1: Build the workspace
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /workspace

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/copy-trader/package.json apps/copy-trader/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/copy-trader apps/copy-trader

RUN pnpm --filter @dca/shared build
RUN pnpm --filter @dca/copy-trader build

RUN pnpm deploy --filter @dca/copy-trader --prod --legacy /deploy

# Stage 2: Production runner
FROM node:22-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /deploy/dist ./dist
COPY --from=builder /deploy/package.json ./
COPY --from=builder /workspace/apps/copy-trader/drizzle ./drizzle

USER node
CMD ["node", "dist/index.js"]
