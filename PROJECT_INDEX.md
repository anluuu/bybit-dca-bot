# Project Index: bybit-dca-bot

Generated: 2026-04-13

Bitcoin DCA bot for Bybit (buys ~250 BRL of BTC every Sunday 08:00 UTC, limit-order → market fallback). Turborepo monorepo: Fastify + BullMQ backend, React + Vite dashboard, shared TS types. Deployed via Dokploy on VPS behind Traefik/nginx. See CLAUDE.md for full context.

## Project Structure

```
.
├── apps/
│   ├── bot/              @dca/bot       Fastify + BullMQ + Drizzle service
│   │   ├── src/          TS sources (flat — no lib/ or utils/)
│   │   └── drizzle/      SQL migrations (do not hand-edit)
│   └── web/              @dca/web       React 19 + Vite + nginx (prod)
│       └── src/
├── packages/
│   └── shared/           @dca/shared    Wire-format TS types (zero runtime deps)
├── docker-compose.yml        prod stack (joins external dokploy-network)
├── docker-compose.dev.yml    local Postgres + Redis
├── turbo.json / pnpm-workspace.yaml
├── ARCHITECTURE.md REQUIREMENTS.md README.md WORKFLOW.md
└── CLAUDE.md                  AI-assistant context (authoritative)
```

## Entry Points

- **Bot service**: `apps/bot/src/index.ts` — boots in order: migrate → seed assets → init Telegram → Redis+BullMQ → repeatable jobs → Fastify :3000 → SIGTERM/SIGINT shutdown
- **Web app**: `apps/web/src/main.tsx` → `apps/web/src/App.tsx` (TanStack Query, 30s refetch)
- **CLI scripts** (root `package.json`): `pnpm dev | build | typecheck | db:generate | db:migrate | dev:db`
- **DB migrator**: `apps/bot/src/db/migrate.ts` (runs at boot and via `pnpm db:migrate`)

## Core Modules — Bot (`apps/bot/src/`)

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `main()` | Bootstraps the service; owns startup order and graceful shutdown |
| `strategy.ts` | `executeDca(asset)`, `executeTestOrder(...)` | DCA orchestration: monthly cap → limit@discount → poll → market fallback → record+notify. **Never change without updating ARCHITECTURE.md** |
| `exchange.ts` | `getTickerPrice`, `placeLimitOrder`, `placeMarketOrder`, `cancelOrder`, `getOrderDetail`, `getSpotBalance`, `ExchangeApiError` (retryable), `ExchangeClientError` (non-retryable), `OrderDetail` | Signed Bybit V5 API client |
| `queue.ts` | `createRedisConnection`, `setupQueue`, `registerJobs` | BullMQ queue + worker; retries: `attempts: 3, backoff: fixed 300s`. One repeatable job per asset |
| `server.ts` | `startServer(redis)` | Fastify app: CORS, cookies, CSRF, JWT, rate-limit, routes (see below) |
| `config.ts` | `config` (frozen) | Zod-validated env vars. Add new env var here + `.env.example` + `docker-compose.yml` + README |
| `logger.ts` | `logger.info/warn/error` | Structured JSON logs; strips secrets. **Never use `console.log`** |
| `notifications.ts` | `initBot`, `notifySuccess`, `notifyFailure`, `notifyCapReached`, `notifyFallback`, `OrderResult` | Fire-and-forget Telegraf notifications (never block DCA) |
| `spending.ts` | `getMonthlySpent(pair)` | Sums current calendar-month `fiat_spent` for non-test orders |
| `db/client.ts` | `db` (Drizzle), `sql` (postgres-js) | DB handles |
| `db/schema.ts` | `assets`, `orders`, types `Asset/NewAsset/Order/NewOrder` | Two tables; indexes on `(pair, executed_at)`, `asset_id`, `status` |
| `db/migrate.ts` | `runMigrations` | Applies `drizzle/migrations/*.sql` |

## HTTP Routes (`apps/bot/src/server.ts`)

**Public** (no auth):
- `GET /health` — liveness
- `GET /health/ready` — postgres + redis probe
- `GET /api/public/summary` — aggregate spend / BTC totals
- `GET /api/public/chart` — cumulative accumulation points
- `POST /api/auth/login` (rate-limited 5/min)
- `POST /api/auth/logout`
- `GET /api/auth/me`

**Admin** (`authPreHandler` / JWT cookie):
- `GET /api/orders?page=&pageSize=` — paginated (`OrdersPage`)
- `GET /api/orders/summary` — `OrdersSummary`
- `GET /api/assets` — asset configs
- `POST /api/test/preview` (10/min) — dry-run `TestOrderPreview`
- `POST /api/test/execute` (2/min) — real small market order tagged `is_test=true`, returns `TestOrderResult`

Add new admin endpoints under the "Private API" block with `authPreHandler`. Public endpoints must live under `/api/public/*`.

## Core Modules — Web (`apps/web/src/`)

| File | Purpose |
|------|---------|
| `App.tsx` | Root; QueryClient (30s refetch); TanStack Query hooks for each endpoint |
| `main.tsx` | React 19 entry |
| `lib/auth.tsx` | `AuthProvider` / `useAuth` — JWT cookie session context |
| `lib/api.ts` | Re-exports types from `@dca/shared` (do NOT redefine types here) |
| `components/StatusCard.tsx` | Health + last-order status |
| `components/SpendingCard.tsx` | Monthly spend vs. cap |
| `components/AccumulationChart.tsx` | Recharts cumulative BTC/BRL chart |
| `components/OrdersTable.tsx` | Paginated order history (min-w-[700px] scroll) |
| `components/TestOrderCard.tsx` | Admin preview + execute test order |
| `components/LoginPage.tsx` | Admin login form |
| `components/ErrorBoundary.tsx` | Class component (only one) |

Conventions: TanStack Query only (no `useEffect` fetching); Lucide icons only; Tailwind v4 tokens in `index.css`; JetBrains Mono for numbers, DM Sans otherwise.

## Shared Types (`packages/shared/src/index.ts`)

`Order`, `OrderType`, `OrderStatus`, `Asset`, `OrdersPage`, `OrdersSummary`, `ChartPoint`, `HealthStatus`, `AuthUser`, `TestOrderPreview`, `TestOrderResult`.

Wire format (ISO strings), NOT DB row shape (Drizzle `Date`). Keep the boundary clean. After edits: `pnpm --filter @dca/shared build`.

## Database Schema

- **`assets`**: `id, pair (uniq), buy_amount, monthly_cap, cron_schedule, limit_discount=0.300, limit_wait_mins=120, enabled=true, created_at, updated_at`
- **`orders`**: `id, asset_id→assets, pair, order_type, bybit_order_id, status, price, quantity, fiat_spent, fee, fee_currency, error_message, is_test=false, executed_at, created_at`
- Migrations: `apps/bot/drizzle/migrations/0000_wise_venom.sql`, `0001_familiar_giant_man.sql`

## Configuration

| File | Purpose |
|------|---------|
| `.env.example` | All env vars (Bybit, Telegram, DCA settings, DB, Redis, admin auth) |
| `docker-compose.yml` | Prod: `bot` (internal-only, `expose: 3000`), `web` (nginx + Traefik labels), `postgres`, `redis`, joins external `dokploy-network` |
| `docker-compose.dev.yml` | Local-only postgres + redis for `pnpm dev` |
| `turbo.json` | Task graph (`shared` builds before `bot`/`web`) |
| `tsconfig.base.json` | Strict, ESM, NodeNext — `.js` extensions in imports |
| `apps/web/nginx.conf` | Serves static build; proxies `/api/*` and `/health/*` to `bot:3000` |
| `apps/bot/drizzle.config.ts` | Drizzle Kit migration generator |

### Key env vars
`BYBIT_API_KEY/SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `BUY_AMOUNT_BRL=250`, `MONTHLY_CAP_BRL=1000`, `CRON_SCHEDULE=0 8 * * 0`, `LIMIT_DISCOUNT_PCT=0.3`, `LIMIT_WAIT_MINUTES=120`, `TRADING_PAIR=BTCBRL`, `TEST_ORDER_AMOUNT_BRL=10`, `DATABASE_URL`, `REDIS_URL`, `PORT=3000`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (≥8), `JWT_SECRET` (≥32).

## Documentation

- `REQUIREMENTS.md` — what the bot does (product-level)
- `ARCHITECTURE.md` — how it works (23KB, deepest reference)
- `README.md` — deployment + config tables
- `WORKFLOW.md` — mostly historical build notes
- `CLAUDE.md` — AI-assistant rules and "don't do this" list (READ FIRST)

## Testing

**None.** Vitest intended when added. Type-check ≠ correctness. (P2 backlog.)

## Key Dependencies

**Bot**: `fastify@^5.8`, `@fastify/{jwt,cors,cookie,csrf-protection,rate-limit}`, `bullmq@^5.73`, `drizzle-orm@^0.45`, `postgres@^3.4`, `ioredis@^5.10`, `axios@^1.15`, `telegraf@^4.16`, `zod@^4.3`, `bcryptjs@^3.0` · `drizzle-kit`, `tsx` (dev)

**Web**: `react@^19.2`, `@tanstack/react-query@^5.99`, `@tanstack/react-router@^1.168`, `recharts@^3.8`, `lucide-react@^1.8`, `tailwindcss@^4.2`, `vite@^8` · tailwind v4 via `@tailwindcss/vite`

**Tooling**: `turbo@^2.3`, `pnpm@10.30.2`, `typescript@^6.0`

## Quick Start

```bash
pnpm install                       # all workspaces
pnpm dev:db                        # local postgres + redis
cp .env.example .env && edit       # set Bybit/Telegram/JWT secrets
pnpm dev                           # runs bot (watch) + web (vite) in parallel
pnpm typecheck                     # verify before committing
pnpm build                         # shared → bot + web (parallel)
docker build -t dca-bot:test -f apps/bot/Dockerfile .   # from repo root!
```

## Critical Rules (from CLAUDE.md)

1. **Bot never publicly exposed** — no `ports:` on the `bot` service.
2. **DCA must not be skipped for DB failures** — trade first, record second.
3. **Telegram failures are silent** — never block DCA.
4. **No `src/lib/` or `src/utils/`** — flat modules only.
5. **No `withRetry` helper** — BullMQ does retries.
6. **No mock-data fallback in frontend** — show `ErrorBanner`.
7. **Never redefine `@dca/shared` types** in web.
8. **Never hand-edit `drizzle/migrations/*.sql`** — edit schema + `pnpm db:generate`.
9. **Never bypass `authPreHandler`** on admin endpoints.
10. **Adding a new coin = `INSERT INTO assets`**, not code.
