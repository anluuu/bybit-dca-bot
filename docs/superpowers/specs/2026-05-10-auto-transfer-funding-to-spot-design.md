# Auto-transfer Funding → Spot — Design

**Status:** Approved, ready for implementation plan
**Date:** 2026-05-10
**Author:** brainstorming session
**Scope:** Make the bot automatically move BRL from the Bybit Funding (FUND) account into the Spot/Unified Trading (UNIFIED) account before placing any order, so that misplaced funds no longer cause DCA failures.

---

## Why

On 2026-05-10 the weekly DCA failed with Bybit code `170131 Insufficient balance`. Root cause: the operator's BRL was deposited into the **Funding wallet**, but the bot only sees the **Unified Trading wallet** when placing spot orders. The bot already classifies `170131` as non-retriable (`ExchangeClientError`), so the DCA row was recorded as `failed` and no retry was attempted. Manual recovery required the operator to transfer BRL via the Bybit UI and then click **Run now** in the dashboard.

A cheap auto-transfer step before each order eliminates this entire failure mode.

## Goals

- The bot never fails a DCA because funds are sitting in the wrong wallet on Bybit.
- Auto-transfer is observable: every transfer produces a structured log line and a low-priority Telegram message.
- Truly-out-of-funds remains a clear, loud failure (different from "misplaced funds") via a critical Telegram alert.
- The same protection applies to `executeDca` (weekly cron), `/api/admin/run-now`, and `executeTestOrder` (`/api/test/execute`).

## Non-goals

- Persisting transfer history to the database. Audit lives in structured logs and Telegram. (Adding a `transfers` table can come later if the operator ever wants a dashboard card for it.)
- Auto-transferring **out** of Spot back to Funding. One-way pump only.
- Transferring assets other than BRL. The DCA buys BTCBRL; the quote currency is BRL. Future multi-pair would extend `coin` parameterization, but this PR scopes to BRL.
- Cross-account asset conversion. The transfer endpoint moves a coin between the same user's wallets; it does not swap.
- Bypassing the monthly cap. The cap check (`spending.ts`) runs **before** transfer logic, so a capped DCA still skips without moving funds.

## Design decisions (from brainstorming)

| Decision | Choice | Reason |
|---|---|---|
| Trigger model | **Hybrid: proactive pre-order check + reactive 170131 catch** | Proactive prevents the common case; reactive defends against races (another process drains Spot between check and order). |
| Transfer amount | **`max(0, buyAmount × 1.1 − currentSpotBalance)`** | Moves only the deficit plus a 10% buffer for fees and intra-order price drift. Funding keeps the rest. |
| Funding empty | **Hard fail + critical Telegram alert** | Mask-prevention: under-spending DCAs is worse than skipping a week loudly. |
| Scope | **DCA + run-now + test orders** | All three paths place real orders that fail on 170131; same fix benefits all. |
| Audit | **Structured logs + info-level Telegram per transfer; no DB table** | Lightweight, no schema churn, log + Telegram is enough to audit. |

## Architecture

A single new module `apps/bot/src/balance.ts` exposes `ensureSpotBalance(coin, required)`. Every place in `strategy.ts` that calls `placeLimitOrder` or `placeMarketOrder` first calls `ensureSpotBalance` to guarantee Spot can fund the order. As a defense in depth, `strategy.ts` also catches `ExchangeClientError` with code `170131` once and retries the order placement after re-running `ensureSpotBalance` — this covers races (another bot or human draining Spot between the check and the order).

If Funding plus Spot together cannot cover the requirement, `ensureSpotBalance` throws a new `InsufficientFundsError` (subclass of `ExchangeClientError`) which propagates as an `UnrecoverableError` through the existing strategy path; the failed row is recorded and a critical Telegram alert fires.

The transfer uses Bybit V5's `POST /v5/asset/transfer/inter-transfer`. Each request includes a client-generated UUID `transferId`, which Bybit uses for idempotency — a retried job re-running the same transfer with the same UUID will not double-transfer.

A module-level in-flight lock keyed by coin prevents two concurrent code paths (e.g. a `run-now` racing a scheduled DCA on the same minute) from each launching their own transfer for the same coin.

## Components

### `apps/bot/src/exchange.ts` — two new exports

```typescript
export async function getFundingBalance(coin: string): Promise<number> {
  // GET /v5/asset/transfer/query-account-coin-balance?accountType=FUND&coin=<coin>
  // Returns parseFloat(result.balance.walletBalance) (or 0 if missing).
  // Throws ExchangeApiError on 5xx / network, ExchangeClientError on 4xx
  // matching the existing convention.
}

export async function transferFundingToSpot(
  coin: string,
  amount: number
): Promise<{ transferId: string }> {
  // POST /v5/asset/transfer/inter-transfer
  // Body: { transferId: crypto.randomUUID(), coin, amount: amount.toFixed(2),
  //         fromAccountType: "FUND", toAccountType: "UNIFIED" }
  // Returns { transferId } on success (Bybit echoes it back).
  // Same error typing as the other exchange.ts functions.
}
```

These mirror the existing `getSpotBalance`/`placeLimitOrder`/etc. functions — same signing flow via the axios interceptor, same `handleResponse` error classification.

### `apps/bot/src/balance.ts` — new module (~80 lines)

```typescript
export class InsufficientFundsError extends ExchangeClientError {
  constructor(
    public available: number,
    public required: number,
    coin: string
  ) {
    super(
      `Insufficient ${coin} balance: have ${available.toFixed(2)} ` +
      `(Spot + Funding), need ${required.toFixed(2)}`
    );
    this.name = "InsufficientFundsError";
  }
}

export interface EnsureResult {
  transferred: boolean;
  transferredAmount?: number;
  transferId?: string;
}

export async function ensureSpotBalance(
  coin: string,
  required: number
): Promise<EnsureResult>;
```

`ensureSpotBalance` flow:

1. `getSpotBalance(coin)` → `spot`.
2. If `spot >= required` → return `{ transferred: false }`.
3. `deficit = required − spot`.
4. `getFundingBalance(coin)` → `funding`.
5. If `spot + funding < required` → throw `InsufficientFundsError(spot + funding, required, coin)`.
6. `transferFundingToSpot(coin, deficit × 1.1)` (10% buffer, but capped at `funding` so we never request more than is there).
7. `logger.info("Auto-transfer Funding→Spot", { coin, amount, transferId, spotBefore: spot, fundingBefore: funding })`.
8. `notifyTransfer(amount, coin, transferId)` (fire-and-forget; never bubbles).
9. Return `{ transferred: true, transferredAmount: amount, transferId }`.

A module-level `Map<string, Promise<EnsureResult>>` coalesces concurrent calls on the same coin (same pattern as `priceCache.ts`).

### `apps/bot/src/strategy.ts` — three insertion points

Each call to `placeLimitOrder` / `placeMarketOrder` in `executeDca` and `executeTestOrder` is wrapped:

```typescript
// Pseudocode — actual code shown in the implementation plan.
async function placeLimitOrderWithRetry(pair, qty, price, requiredBrl) {
  await ensureSpotBalance("BRL", requiredBrl);
  try {
    return await placeLimitOrder(pair, qty, price);
  } catch (error) {
    if (error instanceof ExchangeClientError && error.statusCode === 170131) {
      logger.warn("Insufficient balance after pre-check — racing top-up", { pair });
      await ensureSpotBalance("BRL", requiredBrl);
      return await placeLimitOrder(pair, qty, price);
    }
    throw error;
  }
}
```

A similar `placeMarketOrderWithRetry` wraps the market path. The wrappers go in `strategy.ts` (private helpers in the same file) rather than `exchange.ts`, because the `requiredBrl` semantics are strategy-level (the strategy knows the buy amount; `exchange.ts` is dumb about it).

If the reactive retry also fails with 170131, the error propagates and the DCA fails — Bybit insists no money is available even though our pre-check said otherwise; that's an exchange-side inconsistency worth alerting on.

The `InsufficientFundsError` path inside `ensureSpotBalance` is converted to `UnrecoverableError` by the existing strategy `try/catch` blocks (the new error subclasses `ExchangeClientError`, which is already handled). The `notifyInsufficientFunds` call goes from `strategy.ts` at the point of catch, not from inside `balance.ts` — keeps `balance.ts` framework-agnostic.

### `apps/bot/src/notifications.ts` — two new exports

```typescript
export async function notifyTransfer(
  amount: number,
  coin: string,
  transferId: string
): Promise<void>;

export async function notifyInsufficientFunds(
  pair: string,
  available: number,
  required: number,
  coin: string
): Promise<void>;
```

`notifyTransfer` uses the `safeAsync` wrapper already in place (commit `a83ee59`) — failure logs and swallows. `notifyInsufficientFunds` is a critical alert (different formatting, e.g. `⚠️` prefix).

### `apps/bot/src/server.ts` — at the `run-now` and `/api/test/execute` paths

No code change required. Both endpoints already go through `executeDca` and `executeTestOrder`, which is where the auto-transfer wrappers live. The new `InsufficientFundsError` propagates through the existing failed-row + Telegram paths in those endpoints unchanged.

## Data flow

```
executeDca(asset)
 │
 ├─ getMonthlySpent → cap check (unchanged)
 ├─ getCompositeSignal (unchanged)
 ├─ getTickerPrice
 │
 ├─ placeLimitOrderWithRetry(pair, qty, price, buyAmount)
 │    ├─ ensureSpotBalance("BRL", buyAmount × 1.1)
 │    │    ├─ getSpotBalance("BRL")
 │    │    ├─ spot >= required ? return { transferred: false }
 │    │    ├─ getFundingBalance("BRL")
 │    │    ├─ spot + funding < required ? throw InsufficientFundsError
 │    │    ├─ transferFundingToSpot("BRL", deficit × 1.1)
 │    │    ├─ logger.info("Auto-transfer", { ... })
 │    │    └─ notifyTransfer(...)
 │    │
 │    └─ placeLimitOrder()
 │         on 170131 → ensureSpotBalance + retry once
 │
 ├─ poll fill / market fallback uses placeMarketOrderWithRetry similarly
 │
 └─ persist row
```

The reactive retry takes `requiredBrl` as input rather than recomputing from price/qty — keeps the wrapper's contract explicit.

## Error handling matrix

| Condition | What happens |
|---|---|
| Spot has the required amount | Skip transfer; place order. Zero new API calls. |
| Spot short, Funding covers deficit | Move `deficit × 1.1`, log info, Telegram info, place order. |
| Spot + Funding < required | `InsufficientFundsError` (subclass of `ExchangeClientError`) → `UnrecoverableError` in strategy → row marked `failed` with errorMessage → critical Telegram via `notifyInsufficientFunds` → no retry. |
| Transfer endpoint 5xx / network error | `ExchangeApiError` → retriable. BullMQ retries the whole DCA job after 5 minutes. The retry rebuilds the transfer with a fresh UUID (Bybit's idempotency rule still applies per-UUID, so a partial transfer that succeeded server-side but timed out client-side would NOT double-spend — Bybit short-circuits the duplicate UUID). |
| Transfer 4xx (bad amount, invalid coin) | `ExchangeClientError` → row marked `failed` + Telegram. Manual operator action required. |
| Race: pre-check OK, then 170131 on `placeLimitOrder` | Reactive layer: `ensureSpotBalance` + retry order once. If the retry also throws 170131, propagate. |
| Two concurrent paths request `ensureSpotBalance` on the same coin | In-flight lock coalesces; only one transfer fires. Both callers receive the same `EnsureResult`. |
| `notifyTransfer` Telegram fails | Swallowed by `safeAsync`. Logged via `logger.error`. DCA proceeds normally. |
| Funding has BRL but transfer endpoint returns "coin not supported" | First time anyone runs this in prod, this would surface. Will manifest as `ExchangeClientError` from `transferFundingToSpot`; same handling as the 4xx branch above. |

## Production rollout

- **No DB migration.** No env vars added.
- **No new dependencies.** `crypto.randomUUID()` is in Node 14+.
- **Backwards compatibility.** All-additive change; existing DCA flow behavior on a fully-funded Spot account is unchanged (just calls `getSpotBalance` once extra per order).
- **Deploy via merge to `main`.** Dokploy `autoDeploy: true` rebuilds the bot container.
- **First-DCA observation.** The next Sunday (or earlier via `run-now`) is the smoke test. Watch the bot logs for `Auto-transfer Funding→Spot` and verify a Telegram info message.

## Testing

No automated tests (per CLAUDE.md P2). Manual verification matrix in the implementation plan covers:

1. Happy path: Spot has 0 BRL, Funding has 1000 BRL → DCA fires `run-now` → log shows auto-transfer, order fills, Telegram info shows the move.
2. Spot already funded: Spot has 1000 BRL, Funding has 0 → DCA fires → no transfer log, no transfer Telegram, order fills.
3. Hard fail: Spot 50, Funding 50, buyAmount 250 → row `failed`, `notifyInsufficientFunds` fires (critical Telegram), no transfer attempted.
4. Test order: Spot 0, Funding 100, `TEST_ORDER_AMOUNT_BRL=50` → transfer 55 BRL, market test order fills, is_test=true.
5. Idempotency check: retry the same DCA job manually (simulate worker retry) — second invocation either skips transfer (Spot now funded) or reuses the same UUID without double-transferring.

## Open questions

None. Brainstorming resolved every design decision.

## Out-of-scope follow-ups (do NOT do in this PR)

- Persisted `transfers` table + dashboard card showing transfer history.
- Auto-transfer Spot → Funding (reverse direction).
- Multi-coin generalization beyond BRL.
- A dashboard widget showing live Funding vs Spot balances.
- Configurable buffer percentage (currently hardcoded 10%).
- Auto-sweep on bot boot ("top up Spot at startup, before any DCAs are due"). The hybrid model in this design already covers boot-time deficiencies via the proactive check on the next DCA execution — sweeping at boot adds complexity without preventing any failure mode.
