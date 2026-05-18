# Claude Code Project Context

This file gives AI assistants the context they need to be productive in this codebase.

---

## What this is

A Bitcoin DCA bot for Bybit exchange. Buys ~250 BRL of BTC every Sunday at 08:00 UTC using a limit-order-with-market-fallback strategy. Includes a React dashboard with admin and public views.

**Status:** Production-ready, deployed via Dokploy on a public VPS.

**Repo type:** Turborepo monorepo with pnpm workspaces.

---

## Architecture in one paragraph

A single Node.js service (`apps/bot/src/index.ts`) boots in this order: validates env vars → runs Drizzle migrations → seeds the assets table → connects to Redis → registers BullMQ repeatable jobs (one per asset) → starts Fastify on port 3000. When a job fires, the worker calls `executeDca(asset)` in `strategy.ts`, which is the entire DCA orchestration. The Fastify server serves `/health/*`, public read-only endpoints, JWT-authenticated admin endpoints, and login/logout. The React dashboard (`apps/web/`) is a separate Vite app that imports API contract types from `@dca/shared`. In production, the dashboard runs in its own nginx container that serves the static build and reverse-proxies `/api/*` and `/health/*` to the bot container — the bot is never exposed publicly.

---

## Workspace layout

```
.
├── apps/
│   ├── bot/          # @dca/bot — Fastify + BullMQ + Drizzle service
│   └── web/          # @dca/web — React + Vite + nginx (in prod)
├── packages/
│   └── shared/       # @dca/shared — API contract types only (no runtime deps)
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── docker-compose.yml
└── docker-compose.dev.yml
```

---

## Where things live

| What | Where |
|------|-------|
| Boot sequence / entry point | `apps/bot/src/index.ts` |
| DCA execution logic | `apps/bot/src/strategy.ts` (`executeDca`, `executeTestOrder`) |
| Bybit API calls | `apps/bot/src/exchange.ts` |
| Cron schedule + retries | `apps/bot/src/queue.ts` (BullMQ) |
| HTTP routes | `apps/bot/src/server.ts` |
| DB schema (Drizzle) | `apps/bot/src/db/schema.ts` |
| DB client | `apps/bot/src/db/client.ts` |
| Monthly cap query | `apps/bot/src/spending.ts` (`getMonthlySpent`) |
| Telegram messages | `apps/bot/src/notifications.ts` |
| Structured logger | `apps/bot/src/logger.ts` |
| Env var schema | `apps/bot/src/config.ts` |
| Shared API types | `packages/shared/src/index.ts` |
| Frontend root + routing | `apps/web/src/App.tsx` |
| Auth context (frontend) | `apps/web/src/lib/auth.tsx` |
| Frontend API types re-export | `apps/web/src/lib/api.ts` (re-exports from `@dca/shared`) |
| Dashboard cards | `apps/web/src/components/{StatusCard,SpendingCard,AccumulationChart,OrdersTable,TestOrderCard}.tsx` |
| Login page | `apps/web/src/components/LoginPage.tsx` |
| Error boundary | `apps/web/src/components/ErrorBoundary.tsx` |
| nginx config (prod proxy) | `apps/web/nginx.conf` |

---

## Where things live — `apps/copy-trader`

| What | Where |
|------|-------|
| Boot sequence | `apps/copy-trader/src/index.ts` |
| Env schema (Zod) | `apps/copy-trader/src/config.ts` |
| Structured logger | `apps/copy-trader/src/logger.ts` |
| Telegram session bootstrap CLI | `apps/copy-trader/src/scripts/auth.ts` (run via `pnpm --filter @dca/copy-trader auth`) |
| MTProto listener (gramjs) | `apps/copy-trader/src/listener.ts` |
| Signal parser (regex + Zod) | `apps/copy-trader/src/parser.ts` |
| Parser tests (Vitest) | `apps/copy-trader/src/parser.test.ts` |
| Boot reconcile (last N msgs) | `apps/copy-trader/src/recovery.ts` |
| HTTP server (Fastify) | `apps/copy-trader/src/server.ts` |
| Notifier (telegraf) | `apps/copy-trader/src/notifications.ts` |
| DB schema (Drizzle) | `apps/copy-trader/src/db/schema.ts` |
| DB migrate runner | `apps/copy-trader/src/db/migrate.ts` |
| Postgres schema | `copy_trader` (same instance as bot) |
| Bybit V5 client | `apps/copy-trader/src/bybit.ts` |
| Instrument info cache | `apps/copy-trader/src/instrumentInfo.ts` |
| Sizing math | `apps/copy-trader/src/sizing.ts` + `sizing.test.ts` |
| Config store (runtime) | `apps/copy-trader/src/configStore.ts` |
| Risk gate (8 guardrails) | `apps/copy-trader/src/riskGate.ts` + `riskGate.test.ts` |
| Executor (dry-run + live) | `apps/copy-trader/src/executor.ts` + `executor.test.ts` |
| BullMQ queue + worker | `apps/copy-trader/src/queue.ts` |
| Position watcher | `apps/copy-trader/src/watcher.ts` |

**F1 scope:** listener + parser + risk gate + dry-run executor + position watcher.
Default `DRY_RUN=true` — every triggered signal is fully *planned* and persisted to
`copy_trader.trades` (status=`DRY_RUN_LOGGED`) but no live order hits Bybit. Flip
`DRY_RUN=false` in the config table via dashboard to go live (only do this after
the F2 plan has been reviewed). The watcher BullMQ job polls Bybit every 30 s for
trades with `dry_run=false` AND status in (PENDING_FILL, OPEN) to reconcile fills,
closes, fees, and PnL.

**Telegram session is a full-account credential** — generated locally via `pnpm --filter @dca/copy-trader auth`, pasted into Dokploy as `COPY_TG_SESSION_STRING`, never committed.

---

## The shared package boundary

`@dca/shared` contains **only TypeScript types** that describe the JSON wire format between the bot's API and the web frontend. It has zero runtime dependencies.

- The bot's Drizzle types in `apps/bot/src/db/schema.ts` describe the **database** (e.g. `executedAt: Date`).
- The shared types describe the **wire** (e.g. `executedAt: string`, since JSON serializes Date as ISO string).
- Don't try to merge these. Keep the boundary clean.

When adding a new API endpoint:
1. Add the response type to `packages/shared/src/index.ts`
2. Build the shared package: `pnpm --filter @dca/shared build`
3. Use the type as the return type in the bot route handler
4. Use the type in the frontend's TanStack Query hook

---

## Conventions

### Backend

- **TypeScript strict mode**, ESM (`"type": "module"`), `.js` extensions in imports (NodeNext resolution)
- **No `src/lib/`, `src/utils/`, no barrel files.** Each module is a single file with a clear name. Direct imports.
- **Zod for validation.** Used in `config.ts` for env vars, `server.ts` for request bodies. Always `safeParse` and return 400 on failure.
- **Drizzle ORM** with the `postgres-js` driver. Always use parameterized queries via Drizzle's API; raw SQL only via the `sql` template tag.
- **Structured JSON logs** via `logger.ts`. Never use `console.log` directly — the logger strips secrets and emits JSON lines.
- **Typed errors** in `exchange.ts`: `ExchangeApiError` (retryable, 5xx/network) vs `ExchangeClientError` (non-retryable, 4xx/auth/insufficient balance). The strategy converts `ExchangeClientError` to BullMQ's `UnrecoverableError` to skip retries.
- **No custom retry utility** — BullMQ handles retries via job options (`attempts: 3, backoff: { type: "fixed", delay: 300_000 }`). Don't build a generic `withRetry`.

### Frontend

- **React 19** with hooks, no class components except `ErrorBoundary` (which has to be a class).
- **TanStack Query** for all data fetching — never `useEffect(() => fetch())`. Default `refetchInterval` is 30s, `retry: 2`. The `/health/ready` query polls every 10s so the status pill stays fresh.
- **Tailwind CSS v4** with custom theme tokens in `apps/web/src/index.css` (`--color-surface-*`, `--color-amber-glow`, etc.). Use these tokens, not arbitrary hex values.
- **Lucide icons only.** No emoji as icons.
- **JetBrains Mono for numbers/data**, DM Sans for everything else. Apply via `font-mono` and the default sans.
- **Conditional rendering over fallback data.** When data isn't available, render `null` or a loading state — never silently substitute mock data in production paths.
- **Import types from `@dca/shared`** (or via `apps/web/src/lib/api.ts` which re-exports them). Don't redefine API types in the frontend.

### Naming

- Workspace packages: `@dca/bot`, `@dca/web`, `@dca/shared`
- Files: kebab-case for multi-word names is fine, but most files are single words (`strategy.ts`, `exchange.ts`)
- DB columns: `snake_case` in SQL, `camelCase` in Drizzle TS via the `name` mapping
- React components: `PascalCase` filenames

---

## Critical design principles

These came from real decisions during development. Don't change them without thinking.

1. **The bot prefers to execute a trade and fail to record it, rather than skip a trade because the DB is down.** A missing DB row is recoverable from Bybit's trade history. A missed DCA week is not. This shapes the order of operations in `strategy.ts`.

2. **Fire-and-forget Telegram notifications.** A Telegram failure must never block or fail a DCA. `notifications.ts` catches errors internally and logs them.

3. **Multi-coin extensibility via the `assets` table.** Adding ETH/BRL is `INSERT INTO assets ...`, not a code change. Don't hardcode pair-specific logic in `strategy.ts`.

4. **Public dashboard exposes sanitized operational data; escalatable fields stay admin-only.** `/api/public/*` returns the full purchase history, monthly breakdown, cumulative chart, summary, and next-scheduled-buy info — but strips `bybitOrderId` (vendor-side identifier), `errorMessage` (may contain stack traces or API-key fragments), DB primary keys, and strategy-tuning asset fields (`limitDiscount`, `limitWaitMins`). `/api/orders` (raw Drizzle rows), `/api/assets` (full config), and `/api/test/*` (real-trade execution) remain behind `authPreHandler`. When adding a new public endpoint, `select()` explicit columns — never spread a raw row.

5. **Bot is never publicly exposed.** Only the `web` (nginx) container is reachable from the internet via Traefik (Dokploy's reverse proxy). The bot uses `expose: ["3000"]` (internal Docker network only). nginx proxies `/api/*` and `/health/*` to `bot:3000`. Don't add a `ports:` entry or Traefik labels to the bot service.

6. **Dokploy + Traefik for production deployment.** The `docker-compose.yml` joins the external `dokploy-network`. Web has Traefik labels for `dca-bot.luancunha.dev` with auto Let's Encrypt SSL. Don't change to `ports:` — that would bypass Traefik. Secrets like `POSTGRES_PASSWORD` are set in Dokploy's env UI, not in `.env.example`.

7. **Idempotency on retries.** If a BullMQ retry runs after the limit order was already placed, the strategy should detect this and not place a duplicate. (Currently relies on the fact that retries happen after 5+ minutes, which is longer than the placement step. Improving this is on the P2 list.)

8. **Test orders are isolated from real DCA accounting.** The `orders.is_test` column tags rows produced by `POST /api/test/execute` / `executeTestOrder()`. All aggregations (`/api/public/summary`, `/api/orders/summary`, chart, monthly-cap lookup in `spending.ts`) must include `AND is_test = false`. The test-execute endpoint also blocks with 409 if a real DCA has a pending order on the same pair within the last 10 min (see `findBusyReason` in `server.ts`).

9. **Bybit V5 quirk: `orderStatus`, not `status`.** When reading an order back from Bybit's V5 REST API, the field is `orderStatus` (see fix in commit c431d2b). Don't regress this — it silently breaks fill detection because the field just comes back `undefined`.

---

## Testing

**There are no tests.** This is a known gap (P2 priority). When adding tests:

- Use Vitest (already a Vite project) for the frontend
- Use Vitest or node:test for the backend
- Mock Bybit API responses for `strategy.ts` tests
- Use a test Postgres container for `spending.ts` and DB integration tests

Don't claim a feature is "tested" if you only checked that it compiles. Type-checking ≠ correctness.

---

## How to run things

| What | Command |
|------|---------|
| Install all deps | `pnpm install` (single command at root) |
| Type-check everything | `pnpm typecheck` (turbo runs all packages) |
| Build everything | `pnpm build` (builds shared first, then bot+web in parallel) |
| Type-check bot only | `pnpm --filter @dca/bot typecheck` |
| Type-check web only | `pnpm --filter @dca/web typecheck` |
| Build shared only | `pnpm --filter @dca/shared build` |
| Run all dev servers | `pnpm dev` (turbo, parallel) |
| Run bot dev only | `pnpm --filter @dca/bot dev` |
| Run web dev only | `pnpm --filter @dca/web dev` |
| Build bot Docker image | `docker build -t dca-bot:test -f apps/bot/Dockerfile .` |
| Build web Docker image | `docker build -t dca-web:test -f apps/web/Dockerfile .` |
| Full prod stack | `docker compose --env-file .env up -d` |

**Important:** Docker builds always run from the **repo root** with `-f apps/<app>/Dockerfile`. The build context is the whole monorepo so `pnpm install --frozen-lockfile` can resolve workspace deps.

---

## Things to avoid

- **Don't add `src/lib/` or `src/utils/` directories.** Keep the structure flat.
- **Don't introduce a generic `withRetry` helper.** BullMQ does retries.
- **Don't fall back to mock data on API failure in the frontend** — show an `ErrorBanner` instead.
- **Don't use `console.log` directly** — use `logger.info/warn/error`.
- **Don't redefine API types in `apps/web/`** — add them to `@dca/shared` once and re-export.
- **Don't add new env vars without updating** `apps/bot/src/config.ts` (Zod schema), `.env.example`, `docker-compose.yml`, and the README config table.
- **Don't commit `.env`** — it's gitignored, but be careful.
- **Don't change the DCA execution flow** (limit → poll → market fallback) without updating REQUIREMENTS.md and ARCHITECTURE.md.
- **Don't touch `apps/bot/drizzle/migrations/*.sql` by hand.** Edit the schema, run `pnpm db:generate`.
- **Don't bypass the `authPreHandler`** for any new admin endpoint. Public endpoints must live under `/api/public/*`.
- **Don't add a `ports:` mapping to the `bot` service in docker-compose.yml.** The bot is internal-only.

---

## Open known issues (P2/P3 backlog)

The spec panel review identified these. None are blockers, but they're documented so AI assistants don't "discover" them and treat them as urgent:

- No automated tests
- Hardcoded BTC/BRL tick size (`.toFixed(6)` in `strategy.ts`) — should fetch from Bybit instrument info
- Telegram failures are silent (no retry queue)
- Single admin user, no user management
- JWT expiry is 7 days (could be shorter with a refresh token flow)
- No CSV export from the dashboard
- No mobile-optimized OrdersTable (currently `min-w-[700px]` with horizontal scroll)
- No automated database backups
- No real-time WebSocket updates (polls every 30s)

---

## Common tasks

### Adding a new coin

1. Don't change any code.
2. Insert into the `assets` table:
   ```sql
   INSERT INTO assets (pair, buy_amount, monthly_cap, cron_schedule)
   VALUES ('ETHBRL', 100.00, 400.00, '0 8 * * 0');
   ```
3. Restart the bot — it will register a new BullMQ repeatable job for that pair.

### Adding a new admin API endpoint

1. Add the response type to `packages/shared/src/index.ts`
2. Run `pnpm --filter @dca/shared build`
3. Add the route in `apps/bot/src/server.ts` under the "Private API" comment block
4. Use `authPreHandler` as the second argument: `app.get("/api/foo", authPreHandler, async () => { ... })`
5. Type the return value with the shared type
6. Add the corresponding hook in `apps/web/src/App.tsx` using TanStack Query with `credentials: "include"`

### Adding a new env var

1. Add it to the Zod schema in `apps/bot/src/config.ts`.
2. Add it to `.env.example` with a sane default or empty placeholder.
3. Add it to `docker-compose.yml` under the `bot` service `environment:` block.
4. Update the README config table.

### Triggering a manual test order (from the dashboard)

1. Log in as admin — the `TestOrderCard` appears at the bottom of the page.
2. Click **Preview** to call `POST /api/test/preview` (rate-limited 10/min) — it returns live price, est. BTC qty, and a `busy` flag if a DCA is currently mid-flight.
3. Click **Execute** to call `POST /api/test/execute` (rate-limited 2/min). This places a real market buy of `TEST_ORDER_AMOUNT_BRL` on Bybit. The row is persisted with `is_test=true` and will not appear in the accumulation chart / monthly cap.
4. A 409 response means `findBusyReason` detected a `pending` order on the same pair within the last 10 minutes — wait for the DCA job to finish.

### Changing the DB schema

1. Edit `apps/bot/src/db/schema.ts`.
2. Run `pnpm db:generate` (root script — proxies to bot package).
3. Inspect the generated SQL in `apps/bot/drizzle/migrations/`.
4. Restart the bot (or run `pnpm db:migrate`) to apply.

### Changing API types (and keeping bot + web in sync)

1. Edit `packages/shared/src/index.ts`.
2. Run `pnpm --filter @dca/shared build` (or just `pnpm build` to do everything).
3. Both `@dca/bot` and `@dca/web` will see the updated types on next type-check.

---

## When in doubt

Read the corresponding doc:

- "What does the bot do?" → REQUIREMENTS.md
- "How does X work?" → ARCHITECTURE.md
- "What's the deployment story?" → README.md
- "What's left to build?" → WORKFLOW.md (mostly historical now)
