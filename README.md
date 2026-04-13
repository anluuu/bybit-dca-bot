# Bybit DCA Bot

Automated Bitcoin Dollar-Cost Averaging bot for Bybit, with a real-time admin dashboard.

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

## Quick Start (Local Dev)

### Prerequisites

- Node 22+
- pnpm 10
- Docker + Docker Compose

### 1. Install dependencies

```bash
pnpm install
cd web && pnpm install && cd ..
```

### 2. Start databases

```bash
pnpm dev:db
```

This spins up Postgres + Redis on `localhost:5432` and `localhost:6379`.

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your Bybit, Telegram, and admin credentials
```

### 4. Run the bot

```bash
pnpm dev
```

The bot will:
- Run migrations
- Seed the BTCBRL asset
- Register the cron job
- Start the Fastify API on port 3000

### 5. Run the dashboard

```bash
cd web && pnpm dev
```

Open <http://localhost:5173>. The Vite dev server proxies API calls to the bot on port 3000.

---

## Production Deployment

This project is built for [Dokploy](https://dokploy.com/) on a VPS.

```bash
docker compose --env-file .env up -d
```

This starts 3 containers:

| Service | Image | Purpose |
|---------|-------|---------|
| `bot` | Built from Dockerfile | Bot + Fastify API + dashboard backend |
| `postgres` | `postgres:16-alpine` | Purchase history, asset config |
| `redis` | `redis:7-alpine` | BullMQ job queue |

All three have health checks, restart policies, and named volumes for persistence.

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
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `PORT` | `3000` | Fastify port |
| `ADMIN_USERNAME` | `admin` | Dashboard login username |

---

## Dashboard

Two views:

- **Public** (`/`): bot status, monthly spending progress, accumulation chart. No order details.
- **Admin** (`/#login`): full purchase history with pagination, all charts and stats.

Login uses JWT in an httpOnly cookie. Rate-limited to 5 attempts/minute.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Runtime | Node 22 |
| Package manager | pnpm |
| HTTP framework | Fastify |
| Job queue | BullMQ (Redis) |
| HTTP client | Axios |
| ORM | Drizzle |
| Database | PostgreSQL 16 |
| Telegram | Telegraf |
| Auth | @fastify/jwt + bcryptjs |
| Frontend | React 19, TanStack Query, Tailwind CSS v4, Recharts |
| Container | Docker (multi-stage Alpine) |

---

## Documentation

- **[REQUIREMENTS.md](./REQUIREMENTS.md)** — Functional and non-functional requirements
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System design, database schema, sequence diagrams
- **[WORKFLOW.md](./WORKFLOW.md)** — Implementation phases and dependency graph
- **[CLAUDE.md](./CLAUDE.md)** — Project context for AI assistants

---

## Project Structure

```
.
├── src/                  # Bot backend
│   ├── config.ts         # Env var validation (Zod)
│   ├── logger.ts         # JSON structured logger
│   ├── exchange.ts       # Bybit V5 API client (axios)
│   ├── strategy.ts       # DCA execution logic
│   ├── spending.ts       # Monthly cap tracker
│   ├── notifications.ts  # Telegram (Telegraf)
│   ├── queue.ts          # BullMQ worker + repeatable jobs
│   ├── server.ts         # Fastify HTTP server (auth, health, API)
│   ├── index.ts          # Entry point
│   └── db/               # Drizzle schema + client + migrations
├── web/                  # React dashboard (Vite + TanStack)
├── drizzle/migrations/   # Generated SQL migrations
├── Dockerfile            # Multi-stage production build
├── docker-compose.yml    # Production stack (bot + postgres + redis)
└── docker-compose.dev.yml # Local dev (postgres + redis only)
```

---

## Scripts

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Run bot in dev mode (tsx watch) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled bot |
| `pnpm db:generate` | Generate Drizzle migration from schema changes |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm dev:db` | Start dev databases (postgres + redis) |
| `pnpm dev:db:down` | Stop dev databases |

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

---

## License

MIT
