# Stage 1: Build the workspace web app
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /workspace

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web

RUN pnpm --filter @dca/shared build
RUN pnpm --filter @dca/web build

# Stage 2: Serve static files with nginx
FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
