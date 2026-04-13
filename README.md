# Bybit DCA Bot

Automated Bitcoin Dollar-Cost Averaging bot for Bybit, with a real-time admin dashboard. Turborepo monorepo: bot service + React dashboard + shared types package.

Buys a fixed BRL amount of BTC every Sunday using a "gentle discount with market fallback" strategy: places a limit order at -0.3% market price, waits 2 hours, falls back to a market order if not filled.

---

## Features

- **Weekly automated buys** on Bybit spot (BTC/BRL by default)
- **Limit-then-market strategy** — never miss a DCA week
- **Monthly spending cap** with skip-and-notify behavior
- **Telegram notifications** for every event (success, failure, fallback, cap reached)
- **Persistent purchase history** in PostgreSQL
- **BullMQ-backed scheduling** — jobs survive restarts, built-in retries
- **Admin dashboard** with order history, accumulation chart, monthly progress
- **Public read-only view** for sharing summary stats
- **Multi-coin ready** — adding ETH/SOL/etc. is a row in the `assets` table

---

## Project Structure

```
.
├── apps/
│   ├── bot/              # Backend service (Fastify + BullMQ + Drizzle)
│   │   ├── src/
│   │   ├── drizzle/migrations/
│   │   └── Dockerfile
│   └── web/              # React dashboard (Vite + TanStack)
│       ├── src/
│       ├── nginx.conf    # Reverse proxy config (prod)
│       └── Dockerfile
├── packages/
│   └── shared/           # API contract types (used by both apps)
├── docker-compose.yml    # Prod stack (bot + web + postgres + redis)
├── docker-compose.dev.yml # Local dev databases only
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

---

## Quick Start (Local Dev)

### Prerequisites

- Node 22+
- pnpm 10
- Docker + Docker Compose

### 1. Install all workspace deps

```bash
pnpm install
```

### 2. Start databases

```bash
pnpm dev:db
```

Spins up Postgres + Redis on `localhost:5432` and `localhost:6379`.

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your Bybit, Telegram, and admin credentials
```

### 4. Run everything

```bash
pnpm dev
```

Turbo runs both apps in parallel:
- Bot on `http://localhost:3000` (Fastify API)
- Dashboard on `http://localhost:5173` (Vite dev server, proxies API to bot)

Open <http://localhost:5173>.

### Run individual apps

```bash
pnpm --filter @dca/bot dev   # bot only
pnpm --filter @dca/web dev   # dashboard only
```

---

## Production Deployment (Dokploy)

This project deploys to [Dokploy](https://dokploy.com/) with Traefik for HTTPS.

### Prerequisites on the VPS

- Dokploy installed
- Traefik running (Dokploy sets this up by default)
- External Docker network `dokploy-network` (Dokploy creates this)
- DNS A record: `dca-bot.luancunha.dev` → VPS IP

### Deploy steps

1. Push the repo and create a new Compose app in Dokploy pointing at this repo.
2. In Dokploy's environment UI, set:
   - `POSTGRES_PASSWORD` (strong password)
   - `BYBIT_API_KEY`, `BYBIT_API_SECRET`
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - `ADMIN_PASSWORD` (min 8 chars)
   - `JWT_SECRET` (`openssl rand -hex 32`)
3. Deploy. Traefik will auto-issue a Let's Encrypt cert for `dca-bot.luancunha.dev`.

### Stack (4 containers)

| Service | Public? | Purpose |
|---------|---------|---------|
| `web` | Yes — `https://dca-bot.luancunha.dev` via Traefik | nginx serves dashboard + reverse-proxies `/api` and `/health` to bot |
| `bot` | No — internal to `dokploy-network` | DCA service + Fastify API |
| `postgres` | No — internal | Purchase history, asset config |
| `redis` | No — internal | BullMQ job queue |

Only `web` is reachable from the internet. The bot's API is never publicly exposed.

### Local docker-compose run (testing the prod build)

You can also test the prod stack locally, but Traefik labels will be ignored without an external Traefik instance. For local stack testing:

```bash
# Create the network manually (matches the external: true declaration)
docker network create dokploy-network

# Set required env vars (or use a local .env)
docker compose --env-file .env up -d
```

Note: without Traefik, `web` won't be reachable on a port. Add a temporary `ports: ["8080:80"]` to the web service for local testing if needed.

---

## Configuration

All configuration is via environment variables. See `.env.example` for the full list.

### Required

| Variable | Description |
|----------|-------------|
| `BYBIT_API_KEY` | Bybit API key (sub-account recommended, spot trading only) |
| `BYBIT_API_SECRET` | Bybit API secret |
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat/group ID |
| `DATABASE_URL` | PostgreSQL connection string |
| `ADMIN_PASSWORD` | Dashboard admin password (min 8 chars) |
| `JWT_SECRET` | At least 32 random characters |
| `POSTGRES_PASSWORD` | Postgres password (used by docker-compose) |

### Optional (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `BUY_AMOUNT_BRL` | `250` | Amount per purchase |
| `MONTHLY_CAP_BRL` | `1000` | Monthly spending limit |
| `CRON_SCHEDULE` | `0 8 * * 0` | UTC cron expression (Sunday 08:00) |
| `LIMIT_DISCOUNT_PCT` | `0.3` | Discount below market for limit order |
| `LIMIT_WAIT_MINUTES` | `120` | How long to wait for limit fill |
| `TRADING_PAIR` | `BTCBRL` | Bybit spot pair |
| `ADMIN_USERNAME` | `admin` | Dashboard login username |

### Local-dev only (overridden in production by docker-compose.yml)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://dca:devpassword@localhost:5432/dca_bot` | Used for `pnpm dev` against `pnpm dev:db` databases |
| `REDIS_URL` | `redis://localhost:6379` | Local Redis |
| `PORT` | `3000` | Bot port (internal in prod) |

---

## Dashboard

Two views (same URL):

- **Public** (`/`): bot status, monthly spending progress, accumulation chart. No order details.
- **Admin** (`/#login`): full purchase history with pagination, all charts and stats.

Login uses JWT in an httpOnly cookie. Rate-limited to 5 attempts/minute.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Monorepo | Turborepo + pnpm workspaces |
| Language | TypeScript |
| Runtime | Node 22 |
| HTTP framework | Fastify |
| Job queue | BullMQ (Redis) |
| HTTP client | Axios |
| ORM | Drizzle |
| Database | PostgreSQL 16 |
| Telegram | Telegraf |
| Auth | @fastify/jwt + bcryptjs |
| Frontend | React 19, TanStack Query, Tailwind CSS v4, Recharts |
| Static serving | nginx (in `web` container) |
| Container | Docker (multi-stage Alpine) |

---

## Documentation

- **[REQUIREMENTS.md](./REQUIREMENTS.md)** — Functional and non-functional requirements
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System design, database schema, sequence diagrams
- **[WORKFLOW.md](./WORKFLOW.md)** — Implementation phases and dependency graph
- **[CLAUDE.md](./CLAUDE.md)** — Project context for AI assistants

---

## Scripts (root)

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Run all apps in dev mode (turbo) |
| `pnpm build` | Build all apps (turbo, with caching) |
| `pnpm typecheck` | Type-check all apps |
| `pnpm dev:db` | Start dev databases (postgres + redis) |
| `pnpm dev:db:down` | Stop dev databases |
| `pnpm db:generate` | Generate Drizzle migration from schema changes |
| `pnpm db:migrate` | Run pending migrations |

### Per-app scripts

```bash
pnpm --filter @dca/bot <script>     # e.g. dev, build, db:generate
pnpm --filter @dca/web <script>     # e.g. dev, build, preview
pnpm --filter @dca/shared build
```

---

## Security Notes

- Bybit API keys should be on a **sub-account** with spot-trading-only permissions
- `.env` is gitignored — never commit it
- API keys are stripped from logs automatically by `logger.ts`
- JWT tokens use httpOnly + sameSite=strict cookies
- CSRF protection enabled on POST endpoints
- Login endpoint rate-limited to 5/minute (brute-force protection)
- Bcrypt password hashing (12 rounds)
- All admin API endpoints require authentication
- Bot is not exposed publicly — only nginx (web container) is

---

## License

MIT
