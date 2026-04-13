# Bybit Bitcoin DCA Bot — Architecture

---

## 1. Project Structure

```
bybit-dca-bot/
├── src/
│   ├── index.ts              # Entry point: bootstrap config, DB, queue, server
│   ├── config.ts             # Env var loading + Zod validation
│   ├── db/
│   │   ├── client.ts         # Drizzle client (postgres-js driver)
│   │   ├── schema.ts         # Table definitions (orders, assets)
│   │   └── migrate.ts        # Run migrations on startup
│   ├── exchange.ts           # Bybit V5 REST API client (axios)
│   ├── strategy.ts           # "Gentle discount with market fallback" orchestration
│   ├── spending.ts           # Monthly cap tracking (queries orders table)
│   ├── queue.ts              # BullMQ worker + repeatable job registration
│   ├── server.ts             # Fastify HTTP server (health + future API)
│   ├── notifications.ts      # Telegram Bot API integration (axios)
│   └── logger.ts             # Structured JSON logger to stdout
├── drizzle/
│   └── migrations/           # Generated SQL migration files
├── drizzle.config.ts         # Drizzle Kit config for migration generation
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── .gitignore
```

No `src/lib/`, no `src/utils/`, no barrel files. Each module is one file with a clear name.

---

## 2. Database Schema

Two tables. The `assets` table makes the bot multi-coin-ready. The `orders` table records every execution attempt.

### 2.1 Table: `assets`

| Column            | Type                    | Constraints                  | Description                                    |
|-------------------|-------------------------|------------------------------|------------------------------------------------|
| `id`              | `serial`                | `PRIMARY KEY`                | Auto-increment ID                              |
| `pair`            | `varchar(20)`           | `NOT NULL`, `UNIQUE`         | Trading pair, e.g. `BTCBRL`                    |
| `buy_amount`      | `numeric(16,2)`         | `NOT NULL`                   | Fiat amount per purchase (e.g. 250.00)         |
| `monthly_cap`     | `numeric(16,2)`         | `NOT NULL`                   | Monthly spending cap in fiat                   |
| `cron_schedule`   | `varchar(50)`           | `NOT NULL`                   | Cron expression, e.g. `0 8 * * 0`             |
| `limit_discount`  | `numeric(5,3)`          | `NOT NULL`, `DEFAULT 0.300`  | Limit order discount percentage                |
| `limit_wait_mins` | `integer`               | `NOT NULL`, `DEFAULT 120`    | Minutes to wait for limit fill before fallback |
| `enabled`         | `boolean`               | `NOT NULL`, `DEFAULT true`   | Whether this asset is actively being purchased |
| `created_at`      | `timestamp with tz`     | `NOT NULL`, `DEFAULT now()`  | Row creation time                              |
| `updated_at`      | `timestamp with tz`     | `NOT NULL`, `DEFAULT now()`  | Last modification time                         |

Adding a new coin is a single insert:

```sql
INSERT INTO assets (pair, buy_amount, monthly_cap, cron_schedule)
VALUES ('ETHBRL', 100.00, 400.00, '0 8 * * 0');
```

On startup, the bot seeds the `assets` table from environment variables if no rows exist.

### 2.2 Table: `orders`

| Column           | Type                    | Constraints                   | Description                                         |
|------------------|-------------------------|-------------------------------|-----------------------------------------------------|
| `id`             | `serial`                | `PRIMARY KEY`                 | Auto-increment ID                                   |
| `asset_id`       | `integer`               | `NOT NULL`, `REFERENCES assets(id)` | FK to the asset being purchased                |
| `pair`           | `varchar(20)`           | `NOT NULL`                    | Denormalized pair for easy querying                 |
| `order_type`     | `varchar(10)`           | `NOT NULL`                    | `limit` or `market`                                 |
| `bybit_order_id` | `varchar(64)`           | `NULLABLE`                    | Bybit exchange order ID                             |
| `status`         | `varchar(20)`           | `NOT NULL`                    | `filled`, `cancelled`, `failed`, `skipped_cap`      |
| `price`          | `numeric(20,8)`         | `NULLABLE`                    | Execution price per unit (null if failed)           |
| `quantity`       | `numeric(20,8)`         | `NULLABLE`                    | Crypto amount received (null if failed)             |
| `fiat_spent`     | `numeric(16,2)`         | `NULLABLE`                    | Total fiat spent including fees (null if failed)    |
| `fee`            | `numeric(20,8)`         | `NULLABLE`                    | Trading fee charged                                 |
| `fee_currency`   | `varchar(10)`           | `NULLABLE`                    | Currency of the fee (BTC, BRL, etc.)                |
| `error_message`  | `text`                  | `NULLABLE`                    | Error details if status is `failed`                 |
| `executed_at`    | `timestamp with tz`     | `NOT NULL`, `DEFAULT now()`   | When the order was executed or attempted            |
| `created_at`     | `timestamp with tz`     | `NOT NULL`, `DEFAULT now()`   | Row creation time                                   |

**Indexes:**

- `idx_orders_pair_executed_at` on `(pair, executed_at)` — for monthly spending queries
- `idx_orders_asset_id` on `(asset_id)` — for per-asset history
- `idx_orders_status` on `(status)` — for dashboard filtering

The `pair` column is intentionally denormalized alongside `asset_id`. Monthly spending queries filter by `pair` and `executed_at` range without needing a join.

---

## 3. Component Architecture

### 3.1 `config.ts` — Configuration

Loads all environment variables and validates them with a Zod schema at startup. If validation fails, the process exits immediately with a clear error listing every invalid or missing variable.

```
Exports:
  config: Config  (frozen object, validated on import)

Zod schema enforces:
  - BYBIT_API_KEY, BYBIT_API_SECRET: non-empty strings
  - TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: non-empty strings
  - BUY_AMOUNT_BRL: positive number
  - MONTHLY_CAP_BRL: positive number, >= BUY_AMOUNT_BRL
  - CRON_SCHEDULE: valid cron expression string
  - LIMIT_DISCOUNT_PCT: number between 0 and 5
  - LIMIT_WAIT_MINUTES: integer between 1 and 1440
  - TRADING_PAIR: non-empty string
  - DATABASE_URL: valid postgres:// URL
  - REDIS_URL: valid redis:// URL
  - PORT: integer (default 3000)
```

### 3.2 `logger.ts` — Structured Logging

Thin wrapper over `console.log`/`console.error` that outputs JSON lines to stdout.

```
Exports:
  logger.info(message, context?)
  logger.warn(message, context?)
  logger.error(message, context?)

Output format:
  {"ts":"2026-04-12T08:00:01.234Z","level":"info","msg":"Limit order placed","orderId":"abc123","pair":"BTCBRL"}
```

Strips any field named `apiKey`, `apiSecret`, `secret`, or `token` if accidentally passed.

### 3.3 `db/client.ts` — Database Client

Creates a Drizzle ORM instance using the `postgres-js` driver. Single connection pool, reused for process lifetime.

### 3.4 `db/schema.ts` — Schema Definitions

Drizzle table definitions for `assets` and `orders`. Exports table objects and inferred types (`Asset`, `NewAsset`, `Order`, `NewOrder`).

### 3.5 `db/migrate.ts` — Migrations

Runs Drizzle Kit migrations on startup before anything else. If migrations fail, the process exits.

### 3.6 `exchange.ts` — Bybit V5 API Client (axios)

Handles all communication with Bybit V5 REST API via **axios**. Signs requests with HMAC-SHA256 per Bybit's authentication spec.

```
Exports:
  getTickerPrice(pair: string): Promise<number>
      — GET /v5/market/tickers?category=spot&symbol={pair}

  placeLimitOrder(pair: string, qty: string, price: string): Promise<string>
      — POST /v5/order/create { category: "spot", side: "Buy", orderType: "Limit", ... }

  placeMarketOrder(pair: string, qty: string): Promise<string>
      — POST /v5/order/create { category: "spot", side: "Buy", orderType: "Market", ... }

  cancelOrder(pair: string, orderId: string): Promise<void>
      — POST /v5/order/cancel

  getOrderDetail(pair: string, orderId: string): Promise<OrderDetail>
      — GET /v5/order/realtime?category=spot&orderId={orderId}

  getSpotBalance(coin: string): Promise<number>
      — GET /v5/account/wallet-balance
```

Axios instance configured with:
- Base URL: `https://api.bybit.com`
- Timeout: 10s
- Request interceptor: adds HMAC-SHA256 signature headers

Typed errors: `ExchangeApiError` (retryable) for 5xx/network/timeout, `ExchangeClientError` (non-retryable) for 4xx/auth/insufficient-balance. Rate limit: on 429, wait `Retry-After` and retry once.

### 3.7 `strategy.ts` — DCA Execution Strategy

The core orchestration module. Called by the BullMQ worker when a job fires.

```
Exports:
  executeDca(asset: Asset): Promise<void>
```

**Flow:**

1. Check monthly spending cap via `spending.getMonthlySpent()`
2. If cap exceeded → insert `skipped_cap` order, notify, return
3. Fetch current price via `exchange.getTickerPrice()`
4. Calculate limit price: `price * (1 - discount/100)`
5. Calculate BTC quantity: `buy_amount / limitPrice`, rounded to tick size
6. Place limit order
7. Insert pending order row into DB
8. Poll `exchange.getOrderDetail()` every 30s for up to `limit_wait_mins`
9. **If filled:** update order to `filled`, notify success
10. **If not filled:** cancel limit order, place market order, record, notify fallback + result
11. **On failure:** retry handled by BullMQ (see Section 3.8)

### 3.8 `queue.ts` — BullMQ Job Queue

Replaces `node-cron` with a **Redis-backed BullMQ queue**. This is the key reliability improvement — jobs persist across restarts and have built-in retry with backoff.

```
Exports:
  setupQueue(db: DrizzleInstance): { queue: Queue, worker: Worker }
```

**Architecture:**

- **Queue:** `dca-jobs` — holds repeatable jobs
- **Worker:** processes jobs by calling `executeDca(asset)`
- **Repeatable jobs:** one per enabled asset, using the asset's cron expression

**Job configuration per asset:**
```
{
  name: "dca-BTCBRL",
  data: { assetId: 1 },
  opts: {
    repeat: { pattern: "0 8 * * 0", tz: "UTC" },
    attempts: 3,
    backoff: { type: "fixed", delay: 300_000 }  // 5 min between retries
  }
}
```

**Why BullMQ over node-cron:**
- Jobs survive process restarts (stored in Redis)
- Built-in retry with configurable backoff (replaces custom `withRetry`)
- Job history and status tracking via Redis
- Per-asset concurrency control (maxConcurrency: 1 per job name)
- If the bot was down at scheduled time, BullMQ fires the missed job on startup

**Worker behavior:**
- On job start: load asset from DB by ID, call `executeDca(asset)`
- On job success: logged automatically
- On job failure (after all attempts): insert `failed` order, call `notifyFailure()`

**Retry is now handled by BullMQ, not by strategy.ts.** The strategy throws on retryable errors, and BullMQ retries the whole job. Non-retryable errors (e.g., auth failure) are thrown with `UnrecoverableError` to skip retries.

### 3.9 `spending.ts` — Monthly Cap Tracking

```
Exports:
  getMonthlySpent(pair: string): Promise<number>
      — SUM(fiat_spent) WHERE pair = $1 AND status = 'filled' AND executed_at in current UTC month
```

No caching. Trivially fast on indexed columns.

### 3.10 `notifications.ts` — Telegram Notifications (Telegraf)

Uses **Telegraf** (`telegraf.js.org`) for Telegram integration. Telegraf provides a typed, ergonomic API over raw HTTP calls and opens the door to future bot commands (e.g., `/status`, `/balance`).

```
Exports:
  initBot(): Telegraf          — creates and returns the Telegraf bot instance
  notifySuccess(details: OrderResult): Promise<void>
  notifyFailure(error: string, pair: string): Promise<void>
  notifyCapReached(pair: string, spent: number, cap: number): Promise<void>
  notifyFallback(pair: string, limitOrderId: string): Promise<void>
```

The bot instance is created once on startup. Notification functions use `bot.telegram.sendMessage(chatId, text, { parse_mode: "MarkdownV2" })`.

Fire-and-forget. A Telegram failure is logged but never blocks or retries the DCA flow.

**Future:** Telegraf can register command handlers (e.g., `/status` to check last order, `/balance` to check BRL balance) without adding another dependency.

### 3.11 `server.ts` — Fastify HTTP Server

Lightweight **Fastify** server for health checks and future dashboard API.

```
Exports:
  startServer(): Promise<void>
```

**Routes (v1):**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns `{ status: "ok", uptime, redis: "connected", postgres: "connected" }` |
| `GET` | `/health/ready` | Deep check — verifies DB and Redis connections are alive |

**Future routes (for React dashboard):**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/orders` | Paginated purchase history |
| `GET` | `/api/orders/summary` | Monthly totals, averages |
| `GET` | `/api/assets` | List configured assets |

These are not implemented now but the Fastify server is ready for them.

**Why Fastify:**
- Docker/Dokploy health checks can hit `/health` instead of `node -e "process.exit(0)"`
- The React dashboard needs an API — Fastify is already running
- Lightweight, fast startup, TypeScript-friendly

### 3.12 `index.ts` — Entry Point

```
1. Load and validate config (exits on failure)
2. Initialize DB client
3. Run migrations (exits on failure)
4. Seed assets table if empty
5. Initialize BullMQ queue + worker
6. Register repeatable jobs for each enabled asset
7. Start Fastify server on PORT
8. Log "Bot started" with config summary (pairs, schedules, amounts — no secrets)
9. Handle SIGTERM/SIGINT:
   a. Stop accepting new jobs
   b. Wait for in-progress jobs (30s timeout)
   c. Close Fastify server
   d. Close Redis connection
   e. Close DB pool
   f. Exit 0
```

---

## 4. Sequence Diagram

```mermaid
sequenceDiagram
    participant Redis as Redis (BullMQ)
    participant Worker as queue.ts Worker
    participant Strategy as strategy.ts
    participant Spending as spending.ts
    participant DB as PostgreSQL
    participant Exchange as Bybit V5 API
    participant Telegram as Telegram API

    Note over Redis: Sunday 08:00 UTC — repeatable job fires

    Redis->>Worker: job { assetId: 1, name: "dca-BTCBRL" }
    Worker->>DB: SELECT * FROM assets WHERE id = 1
    DB-->>Worker: asset { pair: "BTCBRL", buy_amount: 250, ... }
    Worker->>Strategy: executeDca(asset)

    Strategy->>Spending: getMonthlySpent("BTCBRL")
    Spending->>DB: SELECT SUM(fiat_spent) WHERE month = current
    DB-->>Spending: 750.00
    Spending-->>Strategy: 750.00

    Note over Strategy: 750 + 250 = 1000 <= 1000 cap — proceed

    Strategy->>Exchange: getTickerPrice("BTCBRL")
    Exchange-->>Strategy: 105,000.00

    Note over Strategy: Limit price = 105,000 × (1 - 0.003) = 104,685.00
    Note over Strategy: Quantity = 250 / 104,685 = 0.00238 BTC

    Strategy->>Exchange: placeLimitOrder("BTCBRL", "0.00238", "104685.00")
    Exchange-->>Strategy: orderId = "abc123"

    Strategy->>DB: INSERT order (status=pending, order_type=limit)

    loop Every 30s for up to 120 minutes
        Strategy->>Exchange: getOrderDetail("BTCBRL", "abc123")
        Exchange-->>Strategy: status = "New" (not yet filled)
    end

    alt Limit order fills within 2 hours
        Exchange-->>Strategy: status = "Filled", price=104685, qty=0.00238, fee=0.000002
        Strategy->>DB: UPDATE order SET status=filled, price, qty, fee, fiat_spent
        Strategy->>Telegram: notifySuccess(details)

    else Limit order not filled after 2 hours
        Strategy->>Exchange: cancelOrder("BTCBRL", "abc123")
        Strategy->>DB: UPDATE order SET status=cancelled
        Strategy->>Telegram: notifyFallback("BTCBRL", "abc123")

        Strategy->>Exchange: placeMarketOrder("BTCBRL", "250")
        Exchange-->>Strategy: orderId = "def456"

        Strategy->>Exchange: getOrderDetail("BTCBRL", "def456")
        Exchange-->>Strategy: status = "Filled", price=105100, qty=0.00237, fee=0.000003

        Strategy->>DB: INSERT order (status=filled, order_type=market, ...)
        Strategy->>Telegram: notifySuccess(details)
    end
```

### Retry Flow (handled by BullMQ)

```mermaid
sequenceDiagram
    participant Redis as Redis (BullMQ)
    participant Worker as queue.ts Worker
    participant Exchange as Bybit V5 API
    participant Telegram as Telegram API

    Redis->>Worker: job attempt 1
    Worker->>Exchange: placeLimitOrder(...)
    Exchange-->>Worker: 500 Internal Server Error
    Worker-->>Redis: throw ExchangeApiError (retryable)

    Note over Redis: Wait 5 minutes (fixed backoff)

    Redis->>Worker: job attempt 2
    Worker->>Exchange: placeLimitOrder(...)
    Exchange-->>Worker: 500 Internal Server Error
    Worker-->>Redis: throw ExchangeApiError (retryable)

    Note over Redis: Wait 5 minutes (fixed backoff)

    Redis->>Worker: job attempt 3
    Worker->>Exchange: placeLimitOrder(...)
    Exchange-->>Worker: 500 Internal Server Error
    Worker-->>Redis: throw ExchangeApiError (retryable)

    Note over Redis: All 3 attempts exhausted — job failed

    Redis->>Worker: onFailed event
    Worker->>Telegram: notifyFailure("Bybit API error after 3 retries", "BTCBRL")
```

---

## 5. Docker and Deployment

### 5.1 Dockerfile (multi-stage build)

```dockerfile
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
```

### 5.2 docker-compose.yml

```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "${PORT:-3000}:${PORT:-3000}"
    environment:
      DATABASE_URL: postgres://dca:${POSTGRES_PASSWORD}@postgres:5432/dca_bot
      REDIS_URL: redis://redis:6379
      BYBIT_API_KEY: ${BYBIT_API_KEY}
      BYBIT_API_SECRET: ${BYBIT_API_SECRET}
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      TELEGRAM_CHAT_ID: ${TELEGRAM_CHAT_ID}
      BUY_AMOUNT_BRL: ${BUY_AMOUNT_BRL:-250}
      MONTHLY_CAP_BRL: ${MONTHLY_CAP_BRL:-1000}
      CRON_SCHEDULE: ${CRON_SCHEDULE:-0 8 * * 0}
      LIMIT_DISCOUNT_PCT: ${LIMIT_DISCOUNT_PCT:-0.3}
      LIMIT_WAIT_MINUTES: ${LIMIT_WAIT_MINUTES:-120}
      TRADING_PAIR: ${TRADING_PAIR:-BTCBRL}
      PORT: ${PORT:-3000}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:${PORT:-3000}/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: dca
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: dca_bot
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dca -d dca_bot"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
  redisdata:
```

### 5.3 Health Check Strategy

- **Bot:** Fastify serves `GET /health` — Docker hits it with `wget`. Returns connection status for Redis and Postgres.
- **Postgres:** `pg_isready`
- **Redis:** `redis-cli ping`
- **Dokploy:** Monitors container health status via Docker.

### 5.4 Infrastructure: 3 containers

```
┌──────────────────────────────────────────┐
│  Dokploy VPS                             │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │   Bot    │──│ Postgres │  │ Redis  │ │
│  │ :3000    │  │ :5432    │  │ :6379  │ │
│  │ Fastify  │  │ pgdata   │  │ AOF    │ │
│  │ BullMQ   │  └──────────┘  └────────┘ │
│  └──────────┘                            │
└──────────────────────────────────────────┘
```

Redis runs with `--appendonly yes` so job state survives Redis restarts.

---

## 6. Error Handling Strategy

### 6.1 Error Classification

| Error Type              | Examples                                       | Retryable | Action                              |
|-------------------------|-------------------------------------------------|-----------|-------------------------------------|
| `ExchangeApiError`      | 5xx from Bybit, network timeout, DNS failure   | Yes       | BullMQ retries (3 attempts, 5-min)  |
| `ExchangeRateLimited`   | 429 from Bybit                                 | Yes       | Wait Retry-After, retry once inline |
| `ExchangeClientError`   | 400, 401, insufficient balance                  | No        | Throw `UnrecoverableError`, skip retries |
| `DatabaseError`         | Connection refused, query timeout               | Yes       | BullMQ retries                      |
| `NotificationError`     | Telegram API failure                            | No        | Log and continue (never blocks DCA) |
| `ConfigError`           | Missing/invalid env var                         | No        | Exit process on startup             |

### 6.2 BullMQ Retry (replaces custom withRetry)

Retry logic is now fully handled by BullMQ:
- `attempts: 3` — max 3 tries per job
- `backoff: { type: "fixed", delay: 300_000 }` — 5 minutes between attempts
- Non-retryable errors thrown as `UnrecoverableError` to abort immediately
- `onFailed` listener on the worker inserts a `failed` order and sends Telegram notification

### 6.3 Behavior When Postgres Is Down

**On startup:** Migrations fail, process exits, Docker restarts it. `depends_on: service_healthy` prevents this in most cases.

**During execution:** DB write failure is retryable. BullMQ retries the whole job.

**Key principle:** The bot prefers to execute the trade and fail to record it, rather than skip a trade because the DB is down.

### 6.4 Behavior When Redis Is Down

**On startup:** BullMQ connection fails, process exits, Docker restarts.

**During execution:** If Redis drops mid-job, the current `executeDca` call continues (it's already in memory). The job result may not be recorded in Redis, but the trade and DB record are unaffected. On reconnect, BullMQ resumes normal operation.

### 6.5 Idempotency

If the bot restarts mid-execution, BullMQ will not re-fire a repeatable job that already fired for the current interval. The in-progress job is considered "stalled" after 30s and will be retried by BullMQ with the normal retry logic. The strategy checks if an order ID was already obtained before placing a new one.

### 6.6 Graceful Shutdown

On `SIGTERM` or `SIGINT`:
1. Stop the BullMQ worker (no new jobs)
2. Wait for in-progress jobs to finish (30s hard timeout)
3. Close Fastify server
4. Close Redis connection
5. Close DB connection pool
6. Exit 0
