# Stage 1: Build
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json drizzle.config.ts ./
COPY src/ src/
COPY drizzle/ drizzle/
RUN pnpm run build

# Stage 2: Production
FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/drizzle/ drizzle/
USER node
CMD ["node", "dist/index.js"]
