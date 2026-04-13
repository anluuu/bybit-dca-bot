# Claude Code Project Context

This file gives AI assistants the context they need to be productive in this codebase.

---

## What this is

A Bitcoin DCA bot for Bybit exchange. Buys ~250 BRL of BTC every Sunday at 08:00 UTC using a limit-order-with-market-fallback strategy. Includes a React dashboard with admin and public views.

**Status:** Production-ready, deployed via Dokploy on a public VPS.

---

## Architecture in one paragraph

A single Node.js service (`src/index.ts`) boots in this order: validates env vars → runs Drizzle migrations → seeds the assets table → connects to Redis → registers BullMQ repeatable jobs (one per asset) → starts Fastify on port 3000. When a job fires, the worker calls `executeDca(asset)` in `strategy.ts`, which is the entire DCA orchestration. The Fastify server serves `/health/*`, public read-only endpoints, JWT-authenticated admin endpoints, and login/logout. The React frontend in `web/` is a separate Vite app that talks to the Fastify API. In production, both are served by the same container (the dashboard isn't currently bundled into the bot image — it's built separately or served by Dokploy's reverse proxy).

---

## Where things live

| What | Where |
|------|-------|
| DCA execution logic | `src/strategy.ts` (`executeDca`) |
| Bybit API calls | `src/exchange.ts` |
| Cron schedule + retries | `src/queue.ts` (BullMQ) |
| HTTP routes | `src/server.ts` |
| DB schema | `src/db/schema.ts` |
| Telegram messages | `src/notifications.ts` |
| Frontend root | `web/src/App.tsx` |
| Auth context (frontend) | `web/src/lib/auth.tsx` |
| Frontend API types | `web/src/lib/api.ts` |

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
- **TanStack Query** for all data fetching — never `useEffect(() => fetch())`. Default `refetchInterval` is 30s.
- **Tailwind CSS v4** with custom theme tokens in `web/src/index.css` (`--color-surface-*`, `--color-amber-glow`, etc.). Use these tokens, not arbitrary hex values.
- **Lucide icons only.** No emoji as icons.
- **JetBrains Mono for numbers/data**, DM Sans for everything else. Apply via `font-mono` and the default sans.
- **Conditional rendering over fallback data.** When data isn't available, render `null` or a loading state — never silently substitute mock data in production paths.

### Naming

- Files: kebab-case for multi-word names is fine, but most files here are single words (`strategy.ts`, `exchange.ts`).
- DB columns: `snake_case` in the SQL, `camelCase` in Drizzle TS via the `name` mapping.
- React components: `PascalCase` filenames, default-export not enforced.

---

## Critical design principles

These came from real decisions during development. Don't change them without thinking.

1. **The bot prefers to execute a trade and fail to record it, rather than skip a trade because the DB is down.** A missing DB row is recoverable from Bybit's trade history. A missed DCA week is not. This shapes the order of operations in `strategy.ts`.

2. **Fire-and-forget Telegram notifications.** A Telegram failure must never block or fail a DCA. `notifications.ts` catches errors internally and logs them.

3. **Multi-coin extensibility via the `assets` table.** Adding ETH/BRL is `INSERT INTO assets ...`, not a code change. Don't hardcode pair-specific logic in `strategy.ts`.

4. **Public dashboard exposes summaries only, not order details.** The split between `/api/public/*` and `/api/*` (auth-required) is intentional. Don't leak order IDs, fees, or per-trade details to the public view.

5. **Idempotency on retries.** If a BullMQ retry runs after the limit order was already placed, the strategy should detect this and not place a duplicate. (Currently relies on the fact that retries happen after 5+ minutes, which is longer than the placement step. Improving this is on the P2 list.)

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
| Type-check backend | `npx tsc --noEmit` |
| Type-check + build frontend | `cd web && pnpm build` |
| Run bot in dev | `pnpm dev` (requires databases via `pnpm dev:db`) |
| Run frontend in dev | `cd web && pnpm dev` (proxies API to localhost:3000) |
| Build Docker image | `docker build -t dca-bot:test .` |
| Full prod stack | `docker compose --env-file .env up -d` |

---

## Things to avoid

- **Don't add `src/lib/` or `src/utils/` directories.** Keep the structure flat.
- **Don't introduce a generic `withRetry` helper.** BullMQ does retries.
- **Don't fall back to mock data on API failure in the frontend** — show an `ErrorBanner` instead. Mock data is for component development only (not currently used).
- **Don't use `console.log` directly** — use `logger.info/warn/error`.
- **Don't add new env vars without updating** `config.ts` (Zod schema), `.env.example`, `docker-compose.yml`, and the README config table.
- **Don't commit `.env`** — it's gitignored, but be careful.
- **Don't change the DCA execution flow** (limit → poll → market fallback) without updating REQUIREMENTS.md and ARCHITECTURE.md.
- **Don't touch `drizzle/migrations/*.sql` by hand.** Edit the schema, run `pnpm db:generate`.
- **Don't bypass the `authPreHandler`** for any new admin endpoint. Public endpoints must live under `/api/public/*`.

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

1. Add the route in `src/server.ts` under the "Private API" comment block.
2. Use `authPreHandler` as the second argument: `app.get("/api/foo", authPreHandler, async () => { ... })`.
3. Add the corresponding hook in `web/src/App.tsx` using TanStack Query with `credentials: "include"`.
4. Add types to `web/src/lib/api.ts`.

### Adding a new env var

1. Add it to the Zod schema in `src/config.ts`.
2. Add it to `.env.example` with a sane default or empty placeholder.
3. Add it to `docker-compose.yml` under the `bot` service `environment:` block.
4. Update the README config table.

### Changing the DB schema

1. Edit `src/db/schema.ts`.
2. Run `pnpm db:generate` — creates a new migration file in `drizzle/migrations/`.
3. Inspect the generated SQL.
4. Restart the bot (or run `pnpm db:migrate`) to apply.

---

## When in doubt

Read the corresponding doc:

- "What does the bot do?" → REQUIREMENTS.md
- "How does X work?" → ARCHITECTURE.md
- "What's the deployment story?" → README.md
- "What's left to build?" → WORKFLOW.md (mostly historical now)
