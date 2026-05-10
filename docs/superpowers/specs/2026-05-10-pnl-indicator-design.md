# Portfolio PnL Indicator — Design

**Status:** Approved, ready for implementation plan
**Date:** 2026-05-10
**Author:** brainstorming session
**Scope:** Add a dashboard card that shows unrealized PnL, ROI %, and average-cost-vs-spot delta for the primary trading pair.

---

## Goals

- Show DCA performance at a glance on the dashboard: how much the holdings are worth right now, the total return, and how far the average buy price sits from the current spot price.
- Stay aligned with the project's "public dashboard exposes sanitized operational data" principle. The three metrics are all derivable from already-public fields (`totalSpent`, `totalBtc`) plus the public Bybit spot price, so no new sensitive information is exposed.
- Be robust to Bybit ticker outages: never blank-render or 500 — fall back to the last known price with a visible staleness indicator.

## Non-goals

- Realized PnL (we don't sell, by design — the strategy is accumulate-only).
- Multi-coin / cross-pair aggregation. Today there is a single asset (BTCBRL); generalize when a second pair is added (YAGNI).
- Historical PnL chart over time. Out of scope for this card — keep it a single point-in-time snapshot.
- Currency conversion (USD, EUR, etc.). All values stay in BRL — matches the rest of the dashboard.
- Persisting price history to the database. Cache is in-memory; restart wipes it and we re-fetch on first request.

## Metrics shown

For the primary asset (currently `BTCBRL`), using only `filled && !isTest` orders:

| Field | Formula | Notes |
|---|---|---|
| `portfolioValue` | `currentPrice × totalBtc` | BRL worth of all accumulated BTC at spot |
| `unrealizedPnl` | `portfolioValue − totalSpent` | Absolute BRL gain/loss vs total invested |
| `roiPct` | `unrealizedPnl / totalSpent × 100` | Percent return on capital deployed |
| `avgVsSpotPct` | `(currentPrice − avgPrice) / avgPrice × 100` | How far today's spot is from DCA average cost; positive = bought cheaper than now |

`avgPrice` is the volume-weighted DCA cost basis already computed by the existing `OrdersSummary` query (`ΣBRL / ΣBTC`).

When `totalBtc === 0` (no buys yet), the three derived metrics return `null` and the UI renders dashes.

## Architecture

### Backend

**New file: `apps/bot/src/priceCache.ts` (~40 lines)**

In-memory price cache keyed by pair. Single module-level `Map<string, { price: number; fetchedAt: number }>`.

API:
```typescript
async function getPrice(pair: string): Promise<{
  price: number | null;       // null only if we have never successfully fetched
  fetchedAt: string;          // ISO timestamp of the cached price
  stale: boolean;             // true if cache is older than TTL_MS
}>
```

Behavior:
- `TTL_MS = 60_000`
- If cache hit and `now - fetchedAt < TTL_MS` → return cached, `stale: false`
- Otherwise call `exchange.getTicker(pair)`:
  - Success → update cache, return fresh, `stale: false`
  - Failure → if we have any previous cache entry, return it with `stale: true`; if we never had one, return `{ price: null, fetchedAt: now, stale: true }`
- A single in-flight `Promise<void>` lock prevents thundering-herd refetches when multiple requests arrive after expiry.
- Errors from `getTicker` are logged at `warn` (not `error`) and swallowed — this is a degraded-but-OK state, not an incident.

**`apps/bot/src/exchange.ts` — add `getTicker(pair)`**

New unsigned GET to Bybit V5 `/v5/market/tickers?category=spot&symbol=<pair>`. Returns `{ lastPrice: number }`. Throws `ExchangeApiError` on 5xx/network (matches existing typed-error convention). Spot-tickers endpoint requires no auth signature.

**`apps/bot/src/server.ts` — new route `GET /api/public/pnl`**

Query string: `?pair=BTCBRL` (optional; default = first enabled asset's pair).

Handler:
1. Resolve target pair (default if absent).
2. Read `OrdersSummary`-shaped aggregate (filled non-test): `totalBtc`, `totalSpent`, `avgPrice`. Reuse the function that backs `GET /api/public/summary` if it is already extracted; otherwise extract it during this work (one private helper, not a new module).
3. Call `priceCache.getPrice(pair)`.
4. Compute derivatives. Return `PortfolioPnl` JSON.

Public endpoint, no `authPreHandler`. The data revealed is all already-public.

### Shared types (`packages/shared/src/index.ts`)

```typescript
/**
 * Snapshot of unrealized PnL on the primary trading pair, served by
 * GET /api/public/pnl. Combines the already-public summary aggregates
 * (totalSpent, totalBtc, avgPrice) with the current Bybit spot price.
 *
 * The bot does NOT change behavior based on this data — it is purely a
 * dashboard indicator for the operator/visitor. `priceStale` flags when
 * the ticker fetch is failing and the values use a cached older price.
 */
export interface PortfolioPnl {
  pair: string;
  currentPrice: number | null;
  /** ISO timestamp of when currentPrice was fetched from Bybit. */
  priceAsOf: string;
  /** true when the ticker fetch failed and we are serving a cached older price. */
  priceStale: boolean;
  totalBtc: number;
  totalSpent: number;
  avgPrice: number;
  /** currentPrice × totalBtc. null when currentPrice is null. */
  portfolioValue: number | null;
  /** portfolioValue − totalSpent. null when currentPrice or totalBtc is 0. */
  unrealizedPnl: number | null;
  /** unrealizedPnl / totalSpent × 100. null when totalSpent is 0 or currentPrice is null. */
  roiPct: number | null;
  /** (currentPrice − avgPrice) / avgPrice × 100. null when avgPrice is 0 or currentPrice is null. */
  avgVsSpotPct: number | null;
  generatedAt: string;
}
```

### Frontend

**New file: `apps/web/src/components/PortfolioCard.tsx` (~100 lines)**

Three-stat grid card mirroring the visual idiom of `SpendingCard`:

- Header: `LineChart` lucide icon + i18n label `portfolio.title`.
- Hero number: `portfolioValue` formatted with `formatCurrency`.
- Secondary line: `unrealizedPnl` with `+`/`−` sign and color (`text-emerald-400` for positive, `text-red-400` for negative, `text-surface-400` for null/zero).
- Stats row (3 columns, same `MiniStat` style as `SpendingCard`):
  - ROI % (signed, colored)
  - Avg cost (`avgPrice`, neutral)
  - Avg vs spot % (signed, colored)
- Stale badge (top-right of header, only when `priceStale === true`): small surface-700 chip with `Clock` icon + text "price as of <relative-time>".

Null / zero-state rules:
- `totalBtc === 0` → render all numbers as `—`. No PnL story to tell.
- `currentPrice === null` → render dashes for portfolio value + PnL + ROI + avg-vs-spot. Show stale badge with "price unavailable" text.

**`apps/web/src/App.tsx`** — insert `PortfolioCard` in the top row between `SpendingCard` and the chart block. The current top row is `Status | Spending`; new layout: `Status | Spending | Portfolio` (or wrap to a second row on narrow screens).

**`apps/web/src/lib/api.ts`** — add `usePnl(pair?)` TanStack Query hook with `refetchInterval: 60_000` and `retry: 2` matching the rest of the queries.

**i18n strings (en, pt-BR)** — `portfolio.title`, `portfolio.value`, `portfolio.pnl`, `portfolio.roi`, `portfolio.avgCost`, `portfolio.avgVsSpot`, `portfolio.priceStale`, `portfolio.priceUnavailable`. Add to `apps/web/src/i18n/en.json` and `pt-BR.json`.

## Data flow

```
[Frontend PortfolioCard] --(60s poll)--> GET /api/public/pnl
                                              |
                                              v
                                       [Fastify handler]
                                              |
                          +-------------------+-------------------+
                          v                                       v
                  [priceCache.getPrice]                  [orders summary query]
                          |                                       |
                  cache hit fresh?                                |
                          |                                       |
              yes <-- no --> exchange.getTicker(pair)             |
              |                       |                           |
              |          success: update cache                    |
              |          failure: keep stale                      |
              v                                                   v
              {price, fetchedAt, stale}                    {totalBtc, totalSpent, avgPrice}
                          \                                       /
                           \                                     /
                            v                                   v
                           [compute portfolioValue/pnl/roi/avgVsSpot]
                                              |
                                              v
                                       PortfolioPnl JSON
```

## Error handling

| Condition | Server response | UI |
|---|---|---|
| Bybit ticker fails, cache available | 200, `priceStale: true`, derived from stale price | Card renders values + "Stale" badge with timestamp |
| Bybit ticker fails, no prior cache | 200, `currentPrice: null`, derivatives null, `priceStale: true` | Card renders dashes + "Price unavailable" badge |
| DB query fails | 500 | TanStack Query renders error state per existing convention |
| `totalBtc === 0` (no buys yet) | 200, derivatives null | Dashes for portfolio metrics; summary fields still populated |
| `totalSpent === 0` (impossible if totalBtc > 0) | Defensive: ROI null | n/a |

No retries inside the handler — TanStack Query already retries 2x on the frontend, and the price cache itself absorbs transient Bybit blips between polls.

## Testing

The project has no automated test suite (acknowledged in CLAUDE.md as P2). Adding a vitest config solely for this card is out of scope.

**Manual verification checklist (run before merge):**

1. `pnpm --filter @dca/shared build && pnpm --filter @dca/bot dev` — boot bot locally.
2. `curl localhost:3000/api/public/pnl | jq` — verify shape matches `PortfolioPnl`, `priceStale: false`, derivatives match hand-computed values from the orders table.
3. Hit twice within 60s — verify only one `getTicker` log line (cache working).
4. Wait >60s — third call refetches.
5. Force ticker failure: temporarily point `BYBIT_API_URL` to a black hole or `iptables -j DROP` Bybit. Hit endpoint — verify `priceStale: true` and the previous values are still returned.
6. Hit `/api/public/pnl?pair=BOGUS` — verify graceful 4xx or `currentPrice: null`.
7. Frontend: load dashboard, see card. Toggle network offline, refresh after 60s — verify stale badge appears, no crash.
8. Empty state: query a fresh dev DB (no orders) — verify dashes everywhere, no NaN strings.

**Regression checks:**
- `pnpm typecheck` clean.
- `SpendingCard` rendering unchanged (it shares `MiniStat` if you refactor; otherwise leave its component alone).
- Public dashboard still loads when logged out.

## Open questions

None. All design decisions resolved during brainstorming.

## Out-of-scope follow-ups (do NOT do in this PR)

- Persist a price-history table for an "Equity curve" chart.
- Add USD-equivalent rendering using a forex API.
- Generalize to multi-pair aggregation when a second asset is added.
- Add "all-time high / low PnL" markers.
