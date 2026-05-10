# Portfolio PnL Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard card that shows unrealized PnL, ROI %, portfolio value, and average-cost-vs-spot delta for the primary trading pair (BTCBRL).

**Architecture:** A new public endpoint `GET /api/public/pnl` reads the same `filled && !isTest` aggregates already used by `/api/public/summary` and combines them with a Bybit spot price fetched through a 60-second in-memory cache. The frontend renders a new `PortfolioCard` next to the existing `SpendingCard`. The card degrades gracefully to the last known cached price with a "stale" badge when the ticker fetch fails.

**Tech Stack:** Node 24 + Fastify + Drizzle (postgres-js) on the bot; React 19 + TanStack Query + Tailwind v4 + i18next on the web. Shared types in `@dca/shared`. Bybit V5 `/v5/market/tickers` (unsigned spot endpoint).

**Spec:** `docs/superpowers/specs/2026-05-10-pnl-indicator-design.md`

---

## File Structure

**New files:**
- `apps/bot/src/priceCache.ts` — In-memory Bybit ticker cache with 60s TTL, stale-fallback, in-flight refetch lock.
- `apps/web/src/components/PortfolioCard.tsx` — Dashboard card rendering portfolio value, PnL, ROI, avg-vs-spot.

**Modified files:**
- `packages/shared/src/index.ts` — Add `PortfolioPnl` interface.
- `apps/bot/src/server.ts` — Add `GET /api/public/pnl` route.
- `apps/web/src/lib/api.ts` — Re-export `PortfolioPnl` type.
- `apps/web/src/App.tsx` — Add `usePnl` hook, render `PortfolioCard` in both admin and public top rows, expand top grid from 2 to 3 columns.
- `apps/web/src/locales/en.ts` — Add `portfolio.*` strings.
- `apps/web/src/locales/pt-BR.ts` — Add `portfolio.*` strings.

**Touched but not significantly modified:**
- `apps/bot/src/exchange.ts` — Reuse the existing `getTickerPrice(pair)` (line 144). No change.

---

## Background facts the implementer needs

- `getTickerPrice(pair: string) => Promise<number>` already exists in `apps/bot/src/exchange.ts:144`. It logs `"Fetched ticker price"` on success and throws `ExchangeApiError` on network/5xx failures. Reuse it; do not duplicate.
- The summary aggregate query (`totalBtc`, `totalSpent`, `avgPrice` over `filled && !isTest`) is duplicated between `/api/public/summary` (server.ts:212) and `/api/orders/summary` (server.ts:509). The PnL handler will run its own copy of the same query — extracting a helper is out of scope for this PR.
- The web app uses `i18next` with locales as TypeScript modules (`apps/web/src/locales/en.ts` and `pt-BR.ts`), **not** JSON files. Add new keys to both files in the same nested object the surrounding strings use.
- There is **no automated test suite** in this repo (P2 in CLAUDE.md). Each task ends with a manual verification step (curl, browser, etc.) instead of `pnpm test`. Do not introduce a test framework as part of this work.
- The top-row grid in `App.tsx` is `md:grid-cols-2` at lines 288 and 396 (admin + public flows). Both must change to 3 columns and both must render `PortfolioCard`.
- TanStack Query convention in this repo: `refetchInterval` is per-hook (most are `30_000`), `retry: 2`. The `/health/ready` query polls every 10s; PnL polls every 60s to match the backend cache TTL.

---

## Tasks

### Task 1: Add `PortfolioPnl` interface to the shared package

**Files:**
- Modify: `packages/shared/src/index.ts` — append after the existing `PublicSignals` interface at the bottom of the file.

- [ ] **Step 1: Append the type definition**

Append at the end of `packages/shared/src/index.ts`:

```typescript
/**
 * Snapshot of unrealized PnL on the primary trading pair, served by
 * GET /api/public/pnl. Combines the already-public summary aggregates
 * (totalSpent, totalBtc, avgPrice) with the current Bybit spot price.
 *
 * The bot does NOT change behavior based on this data — it is purely a
 * dashboard indicator. `priceStale` flags when the ticker fetch is
 * failing and the values use a cached older price.
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
  /** portfolioValue − totalSpent. null when currentPrice is null or totalBtc is 0. */
  unrealizedPnl: number | null;
  /** unrealizedPnl / totalSpent × 100. null when totalSpent is 0 or currentPrice is null. */
  roiPct: number | null;
  /** (currentPrice − avgPrice) / avgPrice × 100. null when avgPrice is 0 or currentPrice is null. */
  avgVsSpotPct: number | null;
  generatedAt: string;
}
```

- [ ] **Step 2: Build the shared package**

Run: `pnpm --filter @dca/shared build`
Expected: exits 0, no errors, `packages/shared/dist/index.d.ts` updated to include `PortfolioPnl`.

- [ ] **Step 3: Type-check the workspace**

Run: `pnpm typecheck`
Expected: exits 0. Verifies no consumer broke.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "Add PortfolioPnl shared type for PnL dashboard endpoint"
```

---

### Task 2: Implement the price cache module

**Files:**
- Create: `apps/bot/src/priceCache.ts`

- [ ] **Step 1: Create the module**

Create `apps/bot/src/priceCache.ts`:

```typescript
import { getTickerPrice } from "./exchange.js";
import { logger } from "./logger.js";

const TTL_MS = 60_000;

interface CacheEntry {
  price: number;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<void>>();

export interface PriceLookup {
  /** null only if we have never successfully fetched this pair. */
  price: number | null;
  /** ISO timestamp of the price (cached or freshly fetched). */
  fetchedAt: string;
  /** true if the cache was expired AND the latest fetch failed; the price (if any) is older than TTL_MS. */
  stale: boolean;
}

export async function getPrice(pair: string): Promise<PriceLookup> {
  const now = Date.now();
  const cached = cache.get(pair);

  if (cached && now - cached.fetchedAt < TTL_MS) {
    return {
      price: cached.price,
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      stale: false,
    };
  }

  // Coalesce concurrent refetches. Multiple requests arriving after TTL
  // expiry would otherwise each call Bybit; serialize them onto one fetch.
  let pending = inflight.get(pair);
  if (!pending) {
    pending = (async () => {
      try {
        const price = await getTickerPrice(pair);
        cache.set(pair, { price, fetchedAt: Date.now() });
      } catch (error) {
        // Degraded state, not an incident. Keep the stale entry (if any)
        // and let callers serve it with stale=true.
        logger.warn("Price refresh failed; serving stale cache", {
          pair,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        inflight.delete(pair);
      }
    })();
    inflight.set(pair, pending);
  }
  await pending;

  const after = cache.get(pair);
  if (after && Date.now() - after.fetchedAt < TTL_MS) {
    return {
      price: after.price,
      fetchedAt: new Date(after.fetchedAt).toISOString(),
      stale: false,
    };
  }

  if (after) {
    // Have a previous successful fetch but the refresh just failed.
    return {
      price: after.price,
      fetchedAt: new Date(after.fetchedAt).toISOString(),
      stale: true,
    };
  }

  // Never had a successful fetch.
  return {
    price: null,
    fetchedAt: new Date().toISOString(),
    stale: true,
  };
}
```

- [ ] **Step 2: Type-check the bot package**

Run: `pnpm --filter @dca/bot typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/priceCache.ts
git commit -m "Add in-memory Bybit ticker cache with 60s TTL and stale fallback"
```

---

### Task 3: Add `GET /api/public/pnl` route

**Files:**
- Modify: `apps/bot/src/server.ts` — add an import and a new route. Insert the route after `/api/public/signals` (which ends around line 431) and before `/api/public/chart` (around line 433).

- [ ] **Step 1: Add the import**

Locate the existing import block at the top of `apps/bot/src/server.ts`. Add the priceCache import next to the other local module imports (near the existing `import { getMonthlySpent } from "./spending.js";` line):

```typescript
import { getPrice } from "./priceCache.js";
```

Also extend the existing `@dca/shared` type import to include `PortfolioPnl`. The current line reads:

```typescript
import type { AdminRunNowResult, PublicSignals } from "@dca/shared";
```

Change it to:

```typescript
import type { AdminRunNowResult, PortfolioPnl, PublicSignals } from "@dca/shared";
```

- [ ] **Step 2: Add the route handler**

Insert this block after the `app.get("/api/public/signals", ...)` handler (i.e., right before `app.get("/api/public/chart", ...)`):

```typescript
  app.get(
    "/api/public/pnl",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const querySchema = z.object({
        pair: z.string().min(1).max(20).optional(),
      });
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid query params" });
      }

      const [firstAsset] = await db.select().from(assets).limit(1);
      if (!firstAsset) {
        return reply.status(404).send({ error: "No asset configured" });
      }
      const pair = parsed.data.pair ?? firstAsset.pair;

      // Reuse the same predicate as /api/public/summary: filled & non-test.
      const [agg] = await db
        .select({
          totalBtc: sql<string>`COALESCE(SUM(${orders.quantity}), 0)`,
          totalSpent: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
          avgPrice: sql<string>`COALESCE(
            SUM(${orders.fiatSpent}) / NULLIF(SUM(${orders.quantity}), 0),
            0
          )`,
        })
        .from(orders)
        .where(
          sql`${orders.status} = 'filled'
            AND ${orders.isTest} = false
            AND ${orders.pair} = ${pair}`
        );

      const totalBtc = parseFloat(agg.totalBtc);
      const totalSpent = parseFloat(agg.totalSpent);
      const avgPrice = parseFloat(agg.avgPrice);

      const priceLookup = await getPrice(pair);
      const currentPrice = priceLookup.price;

      const portfolioValue =
        currentPrice !== null ? currentPrice * totalBtc : null;
      const unrealizedPnl =
        portfolioValue !== null && totalBtc > 0
          ? portfolioValue - totalSpent
          : null;
      const roiPct =
        unrealizedPnl !== null && totalSpent > 0
          ? (unrealizedPnl / totalSpent) * 100
          : null;
      const avgVsSpotPct =
        currentPrice !== null && avgPrice > 0
          ? ((currentPrice - avgPrice) / avgPrice) * 100
          : null;

      const body: PortfolioPnl = {
        pair,
        currentPrice,
        priceAsOf: priceLookup.fetchedAt,
        priceStale: priceLookup.stale,
        totalBtc,
        totalSpent,
        avgPrice,
        portfolioValue,
        unrealizedPnl,
        roiPct,
        avgVsSpotPct,
        generatedAt: new Date().toISOString(),
      };
      return body;
    }
  );
```

- [ ] **Step 3: Type-check the bot package**

Run: `pnpm --filter @dca/bot typecheck`
Expected: exits 0.

- [ ] **Step 4: Manual verification — start the bot locally**

Run: `pnpm --filter @dca/bot dev`
Expected: bot logs "Fastify server started" at port 3000.

- [ ] **Step 5: Manual verification — curl the new endpoint**

In another terminal, run:

```bash
curl -s http://localhost:3000/api/public/pnl | jq
```

Expected: a JSON object with keys matching the `PortfolioPnl` interface. `currentPrice` is a positive number, `priceStale: false`, and the derivatives are numeric (or null if your local DB has zero filled orders). `pair` defaults to the first asset's pair.

- [ ] **Step 6: Manual verification — cache works**

Curl the endpoint twice within 60 seconds. Check the bot logs (`fetched ticker price`): only **one** ticker fetch should appear in the second window.

- [ ] **Step 7: Manual verification — TTL expiry**

Wait 65 seconds, curl again. A second `Fetched ticker price` log line appears.

- [ ] **Step 8: Manual verification — explicit pair query**

```bash
curl -s 'http://localhost:3000/api/public/pnl?pair=BTCBRL' | jq .pair
```

Expected: `"BTCBRL"`.

- [ ] **Step 9: Commit**

```bash
git add apps/bot/src/server.ts
git commit -m "Add GET /api/public/pnl endpoint with cached Bybit ticker"
```

---

### Task 4: Re-export `PortfolioPnl` from the web package

**Files:**
- Modify: `apps/web/src/lib/api.ts` — add `PortfolioPnl` to the re-exported list.

- [ ] **Step 1: Add the type to the re-export**

In `apps/web/src/lib/api.ts`, the file currently re-exports types from `@dca/shared`. Add `PortfolioPnl` to the export list. The export block becomes:

```typescript
export type {
  Order,
  Asset,
  OrdersPage,
  OrdersSummary,
  ChartPoint,
  HealthStatus,
  AuthUser,
  TestOrderPreview,
  TestOrderResult,
  AdminRunNowResult,
  MonthlyBreakdown,
  PublicMonthlyBreakdown,
  PublicOrder,
  PublicOrdersPage,
  PublicStatus,
  PublicSignals,
  PortfolioPnl,
  SignalFallback,
} from "@dca/shared";
```

- [ ] **Step 2: Type-check the web package**

Run: `pnpm --filter @dca/web typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "Re-export PortfolioPnl from the web api type barrel"
```

---

### Task 5: Add i18n strings for the portfolio card

**Files:**
- Modify: `apps/web/src/locales/en.ts`
- Modify: `apps/web/src/locales/pt-BR.ts`

- [ ] **Step 1: Inspect the existing structure**

Run: `head -40 apps/web/src/locales/en.ts`

Notice keys are grouped by feature (e.g. `spending: { ... }`). The new keys go in a sibling `portfolio: { ... }` object. Follow the surrounding style for nesting depth and quote style.

- [ ] **Step 2: Add `portfolio.*` to English**

In `apps/web/src/locales/en.ts`, add a new top-level object next to `spending`:

```typescript
  portfolio: {
    title: "Portfolio",
    value: "Value",
    pnl: "Unrealized P&L",
    roi: "ROI",
    avgCost: "Avg cost",
    avgVsSpot: "Avg vs spot",
    priceStale: "Price as of {{when}}",
    priceUnavailable: "Price unavailable",
    noData: "No buys yet",
  },
```

- [ ] **Step 3: Add `portfolio.*` to Portuguese**

In `apps/web/src/locales/pt-BR.ts`, add the same shape:

```typescript
  portfolio: {
    title: "Portfólio",
    value: "Valor",
    pnl: "L/P não realizado",
    roi: "Retorno",
    avgCost: "Preço médio",
    avgVsSpot: "Médio vs spot",
    priceStale: "Preço de {{when}}",
    priceUnavailable: "Preço indisponível",
    noData: "Sem compras ainda",
  },
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @dca/web typecheck`
Expected: exits 0. (i18next typing in this repo doesn't enforce key existence at compile-time, but the locale modules themselves need to remain valid TS.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/locales/en.ts apps/web/src/locales/pt-BR.ts
git commit -m "Add i18n strings for portfolio PnL card"
```

---

### Task 6: Implement `PortfolioCard.tsx`

**Files:**
- Create: `apps/web/src/components/PortfolioCard.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/PortfolioCard.tsx`:

```typescript
import { LineChart, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PortfolioPnl } from "../lib/api.ts";
import { formatCurrency, formatCurrencyCompact } from "../lib/format.ts";
import dayjs from "dayjs";

interface PortfolioCardProps {
  pnl: PortfolioPnl;
}

function formatSignedCurrency(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

function formatSignedPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function colorClass(value: number | null): string {
  if (value === null || value === 0) return "text-surface-400";
  return value > 0 ? "text-emerald-400" : "text-red-400";
}

export function PortfolioCard({ pnl }: PortfolioCardProps) {
  const { t } = useTranslation();
  const priceUnavailable = pnl.currentPrice === null;
  const stalenessLabel = priceUnavailable
    ? t("portfolio.priceUnavailable")
    : t("portfolio.priceStale", { when: dayjs(pnl.priceAsOf).fromNow() });

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LineChart className="h-4 w-4 text-amber-glow" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
            {t("portfolio.title")}
          </h2>
        </div>
        {pnl.priceStale && (
          <span className="flex items-center gap-1 rounded-full bg-surface-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-surface-400">
            <Clock className="h-3 w-3" />
            {stalenessLabel}
          </span>
        )}
      </div>

      {/* Hero: portfolio value */}
      <div className="mb-1 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold tabular-nums text-surface-100">
          {pnl.portfolioValue !== null ? formatCurrency(pnl.portfolioValue) : "—"}
        </span>
        <span className="text-xs text-surface-400">{t("portfolio.value")}</span>
      </div>

      {/* Secondary: PnL with color + sign */}
      <div className="mb-4 flex items-baseline gap-2">
        <span
          className={`font-mono text-sm font-medium tabular-nums ${colorClass(
            pnl.unrealizedPnl
          )}`}
        >
          {formatSignedCurrency(pnl.unrealizedPnl)}
        </span>
        <span className="text-xs text-surface-400">{t("portfolio.pnl")}</span>
      </div>

      {/* Stats row: ROI | avg cost | avg vs spot */}
      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-surface-700/30">
        <MiniStat
          label={t("portfolio.roi")}
          value={formatSignedPct(pnl.roiPct)}
          colorValue={pnl.roiPct}
        />
        <MiniStat
          label={t("portfolio.avgCost")}
          value={
            pnl.avgPrice > 0 ? formatCurrencyCompact(pnl.avgPrice) : "—"
          }
        />
        <MiniStat
          label={t("portfolio.avgVsSpot")}
          value={formatSignedPct(pnl.avgVsSpotPct)}
          colorValue={pnl.avgVsSpotPct}
        />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  colorValue,
}: {
  label: string;
  value: string;
  colorValue?: number | null;
}) {
  const color =
    colorValue !== undefined ? colorClass(colorValue) : "text-surface-100";
  return (
    <div>
      <p className="text-xs text-surface-400">{label}</p>
      <p
        className={`mt-0.5 font-mono text-sm font-medium tabular-nums ${color}`}
      >
        {value}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify dayjs `fromNow` is already wired up**

Run: `grep -rn "relativeTime\|fromNow" apps/web/src/`

If `dayjs.extend(relativeTime)` is **already** imported somewhere (likely `apps/web/src/main.tsx` or an existing component), no further work needed.

If **not present**, fall back to a minimal local formatter inside this component — replace the `dayjs(pnl.priceAsOf).fromNow()` call with:

```typescript
const ageSec = Math.max(
  0,
  Math.floor((Date.now() - new Date(pnl.priceAsOf).getTime()) / 1000)
);
const stalenessLabel = priceUnavailable
  ? t("portfolio.priceUnavailable")
  : t("portfolio.priceStale", {
      when:
        ageSec < 60
          ? `${ageSec}s ago`
          : `${Math.floor(ageSec / 60)}m ago`,
    });
```

and remove the `import dayjs from "dayjs";` line.

- [ ] **Step 3: Type-check the web package**

Run: `pnpm --filter @dca/web typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PortfolioCard.tsx
git commit -m "Add PortfolioCard component with PnL, ROI, and avg-vs-spot stats"
```

---

### Task 7: Wire `usePnl` hook and render the card

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add the imports**

Locate the existing import line for `SpendingCard`. Add a sibling import:

```typescript
import { PortfolioCard } from "./components/PortfolioCard.tsx";
```

Locate the existing type-only import block from `./lib/api.ts` and add `PortfolioPnl` to it. For example, if the current import looks like:

```typescript
import type { OrdersPage, OrdersSummary, ChartPoint, HealthStatus, Asset, MonthlyBreakdown, PublicMonthlyBreakdown, PublicOrdersPage, PublicStatus } from "./lib/api.ts";
```

Add `PortfolioPnl` to the list. If the imports are split across multiple lines or files, follow the file's existing style.

- [ ] **Step 2: Add the `usePnl` hook**

Find the existing `useSummary()` function definition (around line 97). Add a new sibling function below it:

```typescript
function usePnl() {
  return useQuery<PortfolioPnl>({
    queryKey: ["pnl"],
    queryFn: async () => {
      const res = await fetch("/api/public/pnl", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    retry: 2,
  });
}
```

- [ ] **Step 3: Call the hook from the admin path**

Find the admin render block (search for `<SpendingCard summary={summary} />` near line 290). Just above the `return (...)` of the admin section — or wherever the existing `useSummary()` is called — add:

```typescript
const { data: pnl } = usePnl();
```

- [ ] **Step 4: Render the card and widen the admin grid**

Find the admin top-row grid (around line 288):

```tsx
<div className="mb-6 grid gap-6 md:grid-cols-2">
  <StatusCard health={health} asset={assets?.[0]} />
  <SpendingCard summary={summary} />
</div>
```

Replace with:

```tsx
<div className="mb-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
  <StatusCard health={health} asset={assets?.[0]} />
  <SpendingCard summary={summary} />
  {pnl && <PortfolioCard pnl={pnl} />}
</div>
```

The `xl:grid-cols-3` keeps the existing 2-column behavior on medium screens (where dashboards are usually viewed on Bybit-class side displays) and adds a third column at extra-large breakpoints. Tweak the breakpoint later if needed.

- [ ] **Step 5: Repeat for the public path**

Find the public top-row grid (around line 396):

```tsx
<div className="mb-6 grid gap-6 md:grid-cols-2">
  <StatusCard health={health} asset={status} />
  <SpendingCard summary={summary} />
</div>
```

Replace with:

```tsx
<div className="mb-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
  <StatusCard health={health} asset={status} />
  <SpendingCard summary={summary} />
  {pnl && <PortfolioCard pnl={pnl} />}
</div>
```

The same `usePnl()` hook serves both paths — call it once at the top level (Step 3) and reference the result in both grids.

- [ ] **Step 6: Type-check the web package**

Run: `pnpm --filter @dca/web typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "Render PortfolioCard in admin and public dashboard top rows"
```

---

### Task 8: End-to-end manual verification

**Files:** No code changes. This task is a verification gate before declaring the feature done.

- [ ] **Step 1: Start the full stack locally**

Run: `pnpm dev`
Expected: bot on `:3000`, web on whatever Vite assigns (usually `:5173`).

- [ ] **Step 2: Confirm the card renders in the public view**

Open the public dashboard in a browser (logged out). Top row should now show three cards: Status, Spending, Portfolio. The Portfolio card shows a positive value matching `currentPrice × totalBtc` from the API.

Sanity-check the math by hand against the JSON returned by `/api/public/summary`:
- `portfolioValue ≈ currentPrice × totalBtc`
- `unrealizedPnl = portfolioValue − totalSpent`
- `roiPct ≈ unrealizedPnl / totalSpent × 100`

- [ ] **Step 3: Confirm the admin view also renders the card**

Log in. Same three cards appear at the top, plus the existing admin-only blocks below.

- [ ] **Step 4: Confirm degraded state**

Stop the bot. The frontend continues polling — TanStack Query will error, the card stays in its previous state.

Restart the bot but force the ticker to fail: temporarily edit `apps/bot/src/exchange.ts:144` to `throw new ExchangeApiError("forced");` at the start of `getTickerPrice`. Restart the bot.

Curl: `curl -s http://localhost:3000/api/public/pnl | jq .priceStale`

- If the bot has been running long enough that the cache has a previous fresh entry, expect `priceStale: true` and `currentPrice` to still have a number.
- On a cold start with no prior fetch, expect `priceStale: true` and `currentPrice: null`.

Verify the UI shows a "Stale" or "Price unavailable" badge.

Revert the forced throw.

- [ ] **Step 5: Confirm empty state**

If you have a fresh dev DB with zero filled orders, the card should render dashes (`—`) for `portfolioValue`, `unrealizedPnl`, `roiPct`, and `avgVsSpotPct`. `avgPrice` shows `—` (since the SQL `NULLIF` returns 0 in this state and the UI guards against `avgPrice <= 0`).

- [ ] **Step 6: Confirm production-equivalent deploy path**

Build the Docker images locally:

```bash
docker build -t dca-bot:test -f apps/bot/Dockerfile .
docker build -t dca-web:test -f apps/web/Dockerfile .
```

Expected: both builds succeed. No new env vars or runtime deps were introduced, so no `.env.example` / `docker-compose.yml` / README updates are required.

- [ ] **Step 7: Confirm lint and typecheck pass cleanly across the monorepo**

```bash
pnpm typecheck
pnpm build
```

Expected: both succeed.

- [ ] **Step 8: Final commit (only if any leftover cleanup)**

If Steps 1–7 surfaced any small fix (e.g., a missed import, a copy-paste typo), commit it now with a descriptive message. Otherwise this task is done with no additional commit.

---

## Out-of-scope reminders

Do **not**, as part of this PR:

- Extract a shared "summary aggregate" helper. The current duplication between `/api/public/summary`, `/api/orders/summary`, and the new `/api/public/pnl` is acceptable; a refactor is a separate task.
- Add a vitest config or any automated tests.
- Persist price history or build a historical PnL chart.
- Generalize PnL to multi-pair aggregation.
- Modify any other dashboard card (SpendingCard, AccumulationChart, etc.).
- Change Bybit V5 client signing logic.

---

## Self-review notes (for the implementer)

- The new endpoint is **public**, intentionally — see the design doc for the threat model. Do not add `authPreHandler`.
- The cache is in-memory and lost on bot restart. That is by design; the first request after restart will hit Bybit. If the restart aligns with a Bybit outage, the user sees `priceStale: true` until Bybit recovers.
- The `inflight` lock in `priceCache.ts` serializes refetches **per pair**, not globally. Two different pairs can refetch in parallel — correct behavior for future multi-coin.
- `pair` query string accepts a value but the spec scopes this PR to BTCBRL. The parameter is wired through to give future multi-pair support a no-code-change path; it is not a feature this PR ships.
- `formatCurrency` and `formatCurrencyCompact` already exist in `apps/web/src/lib/format.ts`. Do not invent new formatters.
- If `pnpm typecheck` complains about `dayjs.fromNow()` being missing, follow Task 6 Step 2's fallback to a local age formatter. Do not modify the global dayjs setup as part of this PR.
