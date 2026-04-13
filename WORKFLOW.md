# Bybit DCA Bot — Implementation Workflow

---

## Phase 1: Project Scaffold

### 1.1 Initialize project
- `pnpm init` with project name `bybit-dca-bot`
- Install dependencies:
  - **Runtime:** `bullmq`, `drizzle-orm`, `postgres`, `zod`, `axios`, `fastify`, `telegraf`, `ioredis`
  - **Dev:** `typescript`, `tsx`, `drizzle-kit`, `@types/node`
- Configure `tsconfig.json` (target ES2022, module NodeNext, outDir `dist/`)
- Create `.gitignore` (node_modules, dist, .env, *.js in root)
- Create `.env.example` with all variables from REQUIREMENTS.md

### 1.2 Config module (`src/config.ts`)
- Define Zod schema for all env vars (including REDIS_URL, PORT)
- Parse and validate on import
- Export frozen `config` object
- Exit process with clear error on validation failure

### 1.3 Logger module (`src/logger.ts`)
- JSON-line structured logger (info, warn, error)
- Strip sensitive fields (apiKey, apiSecret, secret, token)
- Output to stdout

**Checkpoint:** `pnpm tsx src/config.ts` loads env vars and logs config summary without secrets.

---

## Phase 2: Database

### 2.1 Drizzle schema (`src/db/schema.ts`)
- Define `assets` table (id, pair, buy_amount, monthly_cap, cron_schedule, limit_discount, limit_wait_mins, enabled, created_at, updated_at)
- Define `orders` table (id, asset_id, pair, order_type, bybit_order_id, status, price, quantity, fiat_spent, fee, fee_currency, error_message, executed_at, created_at)
- Define indexes: `idx_orders_pair_executed_at`, `idx_orders_asset_id`, `idx_orders_status`
- Export inferred types: `Asset`, `NewAsset`, `Order`, `NewOrder`

### 2.2 Drizzle client (`src/db/client.ts`)
- Create postgres-js connection using `DATABASE_URL`
- Create and export Drizzle instance

### 2.3 Drizzle config + migrations
- Create `drizzle.config.ts` pointing to schema and migrations dir
- Generate initial migration with `pnpm drizzle-kit generate`

### 2.4 Migration runner (`src/db/migrate.ts`)
- Run migrations on startup
- Exit process on failure

### 2.5 Asset seeding logic
- On startup, if `assets` table is empty, seed from env vars

**Checkpoint:** Start PostgreSQL via docker-compose, run `pnpm tsx src/db/migrate.ts`, verify tables exist and seed row is inserted.

---

## Phase 3: Bybit Exchange Client

### 3.1 Exchange module (`src/exchange.ts`)
- Create axios instance with base URL `https://api.bybit.com` and 10s timeout
- Implement HMAC-SHA256 request signing via axios request interceptor
- Implement functions:
  - `getTickerPrice(pair)` — GET /v5/market/tickers
  - `placeLimitOrder(pair, qty, price)` — POST /v5/order/create
  - `placeMarketOrder(pair, qty)` — POST /v5/order/create
  - `cancelOrder(pair, orderId)` — POST /v5/order/cancel
  - `getOrderDetail(pair, orderId)` — GET /v5/order/realtime
  - `getSpotBalance(coin)` — GET /v5/account/wallet-balance
- Define typed errors: `ExchangeApiError` (retryable), `ExchangeClientError` (non-retryable)
- Handle 429 rate limiting (wait Retry-After, retry once)

**Checkpoint:** Run `getTickerPrice("BTCBRL")` and `getSpotBalance("BRL")` against live Bybit API. Verify price returns a number.

---

## Phase 4: Telegram Notifications

### 4.1 Notifications module (`src/notifications.ts`)
- Initialize Telegraf bot instance from `TELEGRAM_BOT_TOKEN`
- Implement notification functions using `bot.telegram.sendMessage()` with MarkdownV2:
  - `notifySuccess(details)` — BTC amount, price, BRL spent, fees
  - `notifyFailure(error, pair)` — error details after 3 retries
  - `notifyCapReached(pair, spent, cap)` — monthly cap info
  - `notifyFallback(pair, limitOrderId)` — limit expired, falling back
- Fire-and-forget: catch errors internally, log, never throw

**Checkpoint:** Call `notifySuccess(...)` with mock data. Verify message appears in Telegram chat.

---

## Phase 5: Spending Cap

### 5.1 Spending module (`src/spending.ts`)
- `getMonthlySpent(pair)` — query orders table for current month's total `fiat_spent` where `status = 'filled'`
- Use UTC month boundaries
- No caching

**Checkpoint:** Insert a test order row, call `getMonthlySpent("BTCBRL")`, verify returned sum matches.

---

## Phase 6: DCA Strategy (Core Logic)

### 6.1 Strategy module (`src/strategy.ts`)
- `executeDca(asset)` — the main orchestration function:
  1. Check monthly cap via `spending.getMonthlySpent()`
  2. If cap exceeded → insert `skipped_cap` order → notify → return
  3. Fetch price via `exchange.getTickerPrice()`
  4. Calculate limit price (price * (1 - discount/100))
  5. Calculate BTC quantity (buy_amount / limitPrice), round to tick size
  6. Place limit order
  7. Insert pending order row
  8. Poll order status every 30s for up to `limit_wait_mins`
  9. If filled → update order row → notify success
  10. If not filled → cancel → place market order → update/insert order → notify fallback + success
- Retryable errors are thrown normally (BullMQ retries the job)
- Non-retryable errors thrown as `UnrecoverableError` to abort immediately
- Idempotency guard: if order ID already obtained, don't place a new one on retry

**Checkpoint:** Test with a minimal live order. Verify full flow: limit order → poll → (fill or market fallback) → DB record → Telegram notification.

---

## Phase 7: BullMQ Queue + Fastify Server

### 7.1 Queue module (`src/queue.ts`)
- Create BullMQ `Queue` named `dca-jobs` connected to Redis
- Create `Worker` that:
  1. Loads asset from DB by `job.data.assetId`
  2. Calls `executeDca(asset)`
- Register repeatable jobs for each enabled asset:
  - `{ repeat: { pattern: asset.cron_schedule, tz: "UTC" }, attempts: 3, backoff: { type: "fixed", delay: 300_000 } }`
- `onFailed` listener: insert `failed` order row + call `notifyFailure()`

### 7.2 Fastify server (`src/server.ts`)
- `GET /health` — returns `{ status: "ok", uptime, redis, postgres }`
- `GET /health/ready` — deep check, verifies DB and Redis connections
- Listen on `PORT` (default 3000)

### 7.3 Entry point (`src/index.ts`)
- Boot sequence:
  1. Load config
  2. Init DB, run migrations
  3. Seed assets if empty
  4. Init BullMQ queue + worker
  5. Register repeatable jobs
  6. Start Fastify server
  7. Log startup summary
  8. Graceful shutdown on SIGTERM/SIGINT

**Checkpoint:** Start all containers, verify cron registers in logs. Temporarily set cron to `* * * * *` to test execution fires. Hit `/health` and verify response. Reset to production schedule.

---

## Phase 8: Docker & Deployment

### 8.1 Dockerfile
- Multi-stage build with pnpm (corepack)
- Node 22 Alpine, non-root `node` user

### 8.2 docker-compose.yml
- 3 services: `bot` (Fastify + BullMQ), `postgres`, `redis`
- Health checks: `/health` endpoint for bot, `pg_isready` for postgres, `redis-cli ping` for redis
- Named volumes: `pgdata`, `redisdata`
- `restart: unless-stopped` on all services

### 8.3 Package scripts
- `"build": "tsc"`
- `"start": "node dist/index.js"`
- `"dev": "tsx src/index.ts"`
- `"db:generate": "drizzle-kit generate"`
- `"db:migrate": "tsx src/db/migrate.ts"`

**Checkpoint:** `docker compose up --build` — all 3 containers start, migrations run, bot logs startup with registered schedules, `/health` returns OK. Restart containers — no data loss.

---

## Phase 9: Final Validation

### 9.1 End-to-end test
- Deploy to Dokploy VPS
- Set cron to run in 2 minutes from now
- Verify: order placed on Bybit → DB record → Telegram notification
- Reset cron to `0 8 * * 0`

### 9.2 Edge case verification
- [ ] Insufficient BRL balance → notifies failure, doesn't crash
- [ ] Monthly cap reached → logs skip, sends cap notification
- [ ] Bybit API down → 3 retries via BullMQ, then failure notification
- [ ] Postgres restart → bot retries, recovers
- [ ] Redis restart → bot recovers, jobs resume
- [ ] Bot container restart → comes back up, jobs re-register
- [ ] `/health` returns degraded state when Redis/Postgres down

### 9.3 Security checklist
- [ ] No secrets in logs
- [ ] `.env` in `.gitignore`
- [ ] Bybit sub-account with spot-trade-only permissions
- [ ] Docker runs as non-root `node` user

---

## Dependency Graph

```
Phase 1 (Scaffold)
  ├── Phase 2 (Database)        — depends on config + logger
  ├── Phase 3 (Exchange)        — depends on config + logger
  └── Phase 4 (Notifications)   — depends on config + logger

Phase 5 (Spending)              — depends on Phase 2

Phase 6 (Strategy)              — depends on Phases 2, 3, 4, 5

Phase 7 (Queue + Server)        — depends on Phase 6

Phase 8 (Docker)                — depends on Phase 7

Phase 9 (Validation)            — depends on Phase 8
```

**Phases 2, 3, 4 can be built in parallel** after Phase 1 is complete.

---

## Next Step

Run `/sc:implement` to start building phase by phase.
