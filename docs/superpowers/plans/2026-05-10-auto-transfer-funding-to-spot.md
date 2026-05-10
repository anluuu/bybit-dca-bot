# Auto-transfer Funding → Spot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Have the bot move BRL from the Bybit Funding wallet into the Spot/Unified Trading wallet automatically whenever a DCA, run-now, or test order would otherwise fail with `170131 Insufficient balance`.

**Architecture:** A new module `apps/bot/src/balance.ts` exposes `ensureSpotBalance(coin, required)`. Every call to `placeLimitOrder`/`placeMarketOrder` in `strategy.ts` is wrapped by `placeLimitOrderWithRetry`/`placeMarketOrderWithRetry` helpers that call `ensureSpotBalance` first (proactive top-up) and also catch `170131` to top up and retry once (reactive defense for races). When Funding+Spot still cannot cover the requirement, a new `InsufficientFundsError` (subclass of `ExchangeClientError`) is thrown — strategy converts it to `UnrecoverableError`, persists a `failed` row, and fires a critical Telegram alert via the new `notifyInsufficientFunds`.

**Tech Stack:** Node 24 + TypeScript ESM + Bybit V5 REST API + Telegraf for Telegram. No new dependencies; uses `crypto.randomUUID()` (Node ≥14).

**Spec:** `docs/superpowers/specs/2026-05-10-auto-transfer-funding-to-spot-design.md`

---

## File Structure

**New files:**
- `apps/bot/src/balance.ts` — `ensureSpotBalance(coin, required)`, `InsufficientFundsError`. Module-level in-flight lock keyed by coin.

**Modified files:**
- `apps/bot/src/exchange.ts` — add `getFundingBalance(coin)` and `transferFundingToSpot(coin, amount)`.
- `apps/bot/src/notifications.ts` — add `notifyTransfer(amount, coin, transferId)` and `notifyInsufficientFunds(pair, available, required, coin)`.
- `apps/bot/src/strategy.ts` — add `placeLimitOrderWithRetry` / `placeMarketOrderWithRetry` private helpers; replace direct calls; convert `InsufficientFundsError` to `UnrecoverableError` + Telegram alert.

**Touched but not significantly modified:**
- `apps/bot/src/index.ts` — no change (the boot sequence still runs as-is).
- `apps/bot/src/server.ts` — no change (run-now and test-execute already go through the wrapped strategy functions).

---

## Background facts the implementer needs

- The Bybit V5 axios client at `apps/bot/src/exchange.ts:69-103` signs every request via an interceptor. New endpoints **must** use the same `client` instance — do not create a parallel axios with manual signing.
- The `handleResponse` function (`exchange.ts:107-140`) decides which Bybit `retCode` is retriable. `170131 Insufficient balance` is already in the non-retriable list (`exchange.ts:117-134`) — that's why today's failure didn't trigger a BullMQ retry storm. Do **not** change this list.
- The strategy already wraps `ExchangeClientError` in `UnrecoverableError` for BullMQ (`strategy.ts:142-145, 245-247`). Our new `InsufficientFundsError` extends `ExchangeClientError`, so this conversion happens automatically.
- The transfer endpoint requires a UUID `transferId` for idempotency. Use `crypto.randomUUID()` from `node:crypto`. Bybit dedupes by UUID — submitting the same UUID twice within ~24h is rejected.
- `notifications.ts` already has the `safeAsync` + `send` plumbing (`notifications.ts:51-74`). All new `notify*` functions must use `safeAsync` so a Telegram failure never breaks DCA.
- There is **no automated test suite** in this repo. Each task ends with a manual verification step where useful, and a `typecheck` step always.
- Bybit V5 endpoints:
  - `GET /v5/asset/transfer/query-account-coin-balance?accountType=FUND&coin=<coin>` returns `{ retCode, retMsg, result: { balance: { walletBalance: string, ... } } }`.
  - `POST /v5/asset/transfer/inter-transfer` body: `{ transferId, coin, amount, fromAccountType, toAccountType }`. Account types used here: `FUND`, `UNIFIED`. Returns `{ retCode, retMsg, result: { transferId, status } }`.
- Bybit returns `amount` as strings, takes amounts as strings — match this in code (use `String(...)` or `.toFixed(2)`).
- The `buyAmount` used by `executeDca` is BRL (the quote currency of BTCBRL). `TEST_ORDER_AMOUNT_BRL` is the same. We always transfer/check BRL — multi-coin generalization is explicitly out of scope.

---

## Tasks

### Task 1: Add `getFundingBalance(coin)` to exchange.ts

**Files:**
- Modify: `apps/bot/src/exchange.ts` — append a new exported function after the existing `getSpotBalance` (which ends around line 326). Reuse the existing `client` axios instance.

- [ ] **Step 1: Append the new function**

At the bottom of `apps/bot/src/exchange.ts`, add:

```typescript
export async function getFundingBalance(coin: string): Promise<number> {
  try {
    const { data } = await client.get<
      BybitResponse<{ balance: { walletBalance: string | null } }>
    >("/v5/asset/transfer/query-account-coin-balance", {
      params: { accountType: "FUND", coin },
    });

    const result = handleResponse(data, "getFundingBalance");
    const raw = result.balance?.walletBalance;
    const balance = raw ? parseFloat(raw) : 0;
    logger.info("Fetched funding balance", { coin, balance });
    return balance;
  } catch (error) {
    if (
      error instanceof ExchangeApiError ||
      error instanceof ExchangeClientError
    )
      throw error;
    throw new ExchangeApiError(
      `getFundingBalance failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

- [ ] **Step 2: Type-check the bot package**

Run: `pnpm --filter @dca/bot typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/exchange.ts
git commit -m "Add getFundingBalance helper for Bybit FUND wallet"
```

---

### Task 2: Add `transferFundingToSpot(coin, amount)` to exchange.ts

**Files:**
- Modify: `apps/bot/src/exchange.ts` — append after `getFundingBalance`. Add `crypto` import at the top if not already present (it is — line 2).

- [ ] **Step 1: Append the new function**

At the bottom of `apps/bot/src/exchange.ts`, after `getFundingBalance`, add:

```typescript
export async function transferFundingToSpot(
  coin: string,
  amount: number
): Promise<{ transferId: string }> {
  // Bybit dedupes inter-account transfers by transferId for ~24h. Generate
  // fresh per call — a retry of the parent DCA job will get a new UUID, but
  // by then the previous transfer (if it actually settled server-side) has
  // already topped up Spot, so the second call short-circuits at the
  // getSpotBalance pre-check in ensureSpotBalance.
  const transferId = crypto.randomUUID();
  const body = {
    transferId,
    coin,
    amount: amount.toFixed(2),
    fromAccountType: "FUND",
    toAccountType: "UNIFIED",
  };

  try {
    const { data } = await client.post<
      BybitResponse<{ transferId: string; status: string }>
    >("/v5/asset/transfer/inter-transfer", body);

    const result = handleResponse(data, "transferFundingToSpot");
    logger.info("Transferred funds", {
      coin,
      amount: body.amount,
      transferId: result.transferId,
      status: result.status,
    });
    return { transferId: result.transferId };
  } catch (error) {
    if (
      error instanceof ExchangeApiError ||
      error instanceof ExchangeClientError
    )
      throw error;
    throw new ExchangeApiError(
      `transferFundingToSpot failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

- [ ] **Step 2: Type-check the bot package**

Run: `pnpm --filter @dca/bot typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/exchange.ts
git commit -m "Add transferFundingToSpot helper for Bybit inter-account transfer"
```

---

### Task 3: Implement `balance.ts` (`ensureSpotBalance` + `InsufficientFundsError`)

**Files:**
- Create: `apps/bot/src/balance.ts`

- [ ] **Step 1: Create the module**

Create `apps/bot/src/balance.ts`:

```typescript
import {
  ExchangeClientError,
  getFundingBalance,
  getSpotBalance,
  transferFundingToSpot,
} from "./exchange.js";
import { logger } from "./logger.js";

export class InsufficientFundsError extends ExchangeClientError {
  constructor(
    public available: number,
    public required: number,
    public coin: string
  ) {
    super(
      `Insufficient ${coin} balance: have ${available.toFixed(2)} (Spot + Funding), need ${required.toFixed(2)}`
    );
    this.name = "InsufficientFundsError";
  }
}

export interface EnsureResult {
  transferred: boolean;
  transferredAmount?: number;
  transferId?: string;
}

// Module-level coalescing lock: if two concurrent code paths (e.g. a scheduled
// DCA racing a manual run-now) both ask to ensure the same coin's Spot
// balance, the second caller awaits the first's Promise instead of launching
// a second transfer. Mirrors the pattern in priceCache.ts.
const inflight = new Map<string, Promise<EnsureResult>>();

export async function ensureSpotBalance(
  coin: string,
  required: number
): Promise<EnsureResult> {
  const existing = inflight.get(coin);
  if (existing) {
    return existing;
  }

  const work = (async (): Promise<EnsureResult> => {
    try {
      const spot = await getSpotBalance(coin);
      if (spot >= required) {
        return { transferred: false };
      }

      const deficit = required - spot;
      const funding = await getFundingBalance(coin);

      if (spot + funding < required) {
        throw new InsufficientFundsError(spot + funding, required, coin);
      }

      // Move deficit + 10% buffer, but never request more than Funding holds.
      const targetAmount = deficit * 1.1;
      const transferAmount = Math.min(targetAmount, funding);

      const { transferId } = await transferFundingToSpot(coin, transferAmount);

      logger.info("Auto-transfer Funding→Spot", {
        coin,
        amount: transferAmount.toFixed(2),
        transferId,
        spotBefore: spot.toFixed(2),
        fundingBefore: funding.toFixed(2),
      });

      return {
        transferred: true,
        transferredAmount: transferAmount,
        transferId,
      };
    } finally {
      inflight.delete(coin);
    }
  })();

  inflight.set(coin, work);
  return work;
}
```

- [ ] **Step 2: Type-check the bot package**

Run: `pnpm --filter @dca/bot typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/balance.ts
git commit -m "Add ensureSpotBalance + InsufficientFundsError module"
```

---

### Task 4: Add `notifyTransfer` and `notifyInsufficientFunds` to notifications.ts

**Files:**
- Modify: `apps/bot/src/notifications.ts` — append two new exports after the existing `notifyFallback` (around line 184). Use `safeAsync` and `escapeMarkdown` per existing convention.

- [ ] **Step 1: Append `notifyTransfer`**

Append at the bottom of `apps/bot/src/notifications.ts`:

```typescript
export function notifyTransfer(
  amount: number,
  coin: string,
  transferId: string
): Promise<void> {
  return safeAsync(async () => {
    const amountStr = escapeMarkdown(
      amount.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    const coinStr = escapeMarkdown(coin);
    const idStr = escapeMarkdown(transferId);
    const msg =
      `*Funds Topped Up*\n\n` +
      `*Amount:* ${amountStr} ${coinStr}\n` +
      `*Direction:* Funding → Spot\n` +
      `*Transfer ID:* ${idStr}`;
    await send(msg);
  });
}
```

- [ ] **Step 2: Append `notifyInsufficientFunds`**

Append immediately after `notifyTransfer`:

```typescript
export function notifyInsufficientFunds(
  pair: string,
  available: number,
  required: number,
  coin: string
): Promise<void> {
  return safeAsync(async () => {
    const pairStr = escapeMarkdown(pair);
    const coinStr = escapeMarkdown(coin);
    const availStr = escapeMarkdown(
      available.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    const reqStr = escapeMarkdown(
      required.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    const msg =
      `*⚠️ INSUFFICIENT FUNDS*\n\n` +
      `*Pair:* ${pairStr}\n` +
      `*Available:* ${availStr} ${coinStr} \\(Spot \\+ Funding\\)\n` +
      `*Required:* ${reqStr} ${coinStr}\n\n` +
      `Deposit ${coinStr} to Bybit and retry via *Run now*\\.`;
    await send(msg);
  });
}
```

- [ ] **Step 3: Type-check the bot package**

Run: `pnpm --filter @dca/bot typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/notifications.ts
git commit -m "Add notifyTransfer + notifyInsufficientFunds Telegram messages"
```

---

### Task 5: Wrap placeLimitOrder / placeMarketOrder calls in strategy.ts

**Files:**
- Modify: `apps/bot/src/strategy.ts`

This is the integration task. There are three call sites:
1. `executeDca` step 5 — `placeLimitOrder` (line 140)
2. `executeDca` step 9 — `placeMarketOrder` (line 243)
3. `executeTestOrder` — `placeMarketOrder` (line 305)

All three become routed through new private wrappers. The wrappers do `ensureSpotBalance` first, then call the real order function, with a reactive retry on `170131`. `InsufficientFundsError` is caught at the strategy level so a tailored Telegram alert can fire before the existing failed-row path takes over.

- [ ] **Step 1: Add the imports**

Locate the existing imports at the top of `apps/bot/src/strategy.ts` (the block ends around line 24). Add:

```typescript
import {
  ensureSpotBalance,
  InsufficientFundsError,
} from "./balance.js";
```

Add `notifyInsufficientFunds` to the existing `./notifications.js` import (which currently imports `notifySuccess`, `notifyFailure`, `notifyCapReached`, `notifyFallback`):

```typescript
import {
  notifySuccess,
  notifyFailure,
  notifyCapReached,
  notifyFallback,
  notifyInsufficientFunds,
} from "./notifications.js";
```

- [ ] **Step 2: Add the wrapper helpers**

Insert these private helpers between the existing `recordOrderResult` function (around line 65) and the `signalColumns` function. (They're module-private — no `export`.) The placement keeps them near the other small helpers used by `executeDca`.

```typescript
const QUOTE_COIN = "BRL";

/**
 * Place a limit order with pre-flight top-up and a single reactive retry.
 *
 * Pre-flight: ensureSpotBalance pulls from Funding if Spot can't cover
 * `requiredBrl`. Reactive: if Bybit *still* says 170131 (Spot drained between
 * check and place — possible if a human or another bot moves BRL out), one
 * more ensureSpotBalance + placeLimitOrder attempt. If that retry also throws
 * 170131 the error propagates and the DCA fails normally.
 *
 * `requiredBrl` is the BRL amount the order intends to consume. The wrapper
 * adds a 10% buffer internally via ensureSpotBalance's deficit math.
 */
async function placeLimitOrderWithRetry(
  pair: string,
  qty: string,
  price: string,
  requiredBrl: number
): Promise<string> {
  const required = requiredBrl * 1.1;
  await ensureSpotBalance(QUOTE_COIN, required);
  try {
    return await placeLimitOrder(pair, qty, price);
  } catch (error) {
    if (
      error instanceof ExchangeClientError &&
      error.statusCode === 170131
    ) {
      logger.warn("Race on insufficient balance — re-topping up and retrying", {
        pair,
        requiredBrl,
      });
      await ensureSpotBalance(QUOTE_COIN, required);
      return await placeLimitOrder(pair, qty, price);
    }
    throw error;
  }
}

async function placeMarketOrderWithRetry(
  pair: string,
  quoteAmount: string,
  requiredBrl: number
): Promise<string> {
  const required = requiredBrl * 1.1;
  await ensureSpotBalance(QUOTE_COIN, required);
  try {
    return await placeMarketOrder(pair, quoteAmount);
  } catch (error) {
    if (
      error instanceof ExchangeClientError &&
      error.statusCode === 170131
    ) {
      logger.warn("Race on insufficient balance — re-topping up and retrying", {
        pair,
        requiredBrl,
      });
      await ensureSpotBalance(QUOTE_COIN, required);
      return await placeMarketOrder(pair, quoteAmount);
    }
    throw error;
  }
}
```

- [ ] **Step 3: Swap the limit-order call in `executeDca`**

Find this block in `executeDca` (around line 137-146):

```typescript
  // 5. Place limit order
  let limitOrderId: string;
  try {
    limitOrderId = await placeLimitOrder(pair, qtyStr, priceStr);
  } catch (error) {
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
```

Replace with:

```typescript
  // 5. Place limit order — wrapper pre-tops Spot from Funding if needed and
  // retries once on a race-induced 170131. InsufficientFundsError surfaces
  // here for the dedicated Telegram alert before the generic Unrecoverable
  // catch fires.
  let limitOrderId: string;
  try {
    limitOrderId = await placeLimitOrderWithRetry(
      pair,
      qtyStr,
      priceStr,
      buyAmount
    );
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      await notifyInsufficientFunds(
        pair,
        error.available,
        error.required,
        error.coin
      );
      throw new UnrecoverableError(error.message);
    }
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
```

- [ ] **Step 4: Swap the market-order call in `executeDca`**

Find this block in `executeDca` (around line 240-249):

```typescript
  // 9. Place market order
  let marketOrderId: string;
  try {
    marketOrderId = await placeMarketOrder(pair, buyAmount.toFixed(2));
  } catch (error) {
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
```

Replace with:

```typescript
  // 9. Place market order via wrapper (same auto-topup + retry as limit).
  let marketOrderId: string;
  try {
    marketOrderId = await placeMarketOrderWithRetry(
      pair,
      buyAmount.toFixed(2),
      buyAmount
    );
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      await notifyInsufficientFunds(
        pair,
        error.available,
        error.required,
        error.coin
      );
      throw new UnrecoverableError(error.message);
    }
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
```

- [ ] **Step 5: Swap the market-order call in `executeTestOrder`**

Find this block in `executeTestOrder` (around line 302-326):

```typescript
  let marketOrderId: string;
  try {
    marketOrderId = await placeMarketOrder(pair, amountBrl.toFixed(2));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const [failedRow] = await db
      .insert(orders)
      .values({
        assetId,
        pair,
        orderType: "market",
        status: "failed",
        errorMessage: msg,
        isTest: true,
      })
      .returning();

    if (
      error instanceof ExchangeClientError ||
      error instanceof ExchangeApiError
    ) {
      return failedRow;
    }
    throw error;
  }
```

Replace with:

```typescript
  let marketOrderId: string;
  try {
    marketOrderId = await placeMarketOrderWithRetry(
      pair,
      amountBrl.toFixed(2),
      amountBrl
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const [failedRow] = await db
      .insert(orders)
      .values({
        assetId,
        pair,
        orderType: "market",
        status: "failed",
        errorMessage: msg,
        isTest: true,
      })
      .returning();

    if (error instanceof InsufficientFundsError) {
      // Test orders fire a critical alert too — operators want to know
      // BEFORE the next scheduled DCA hits the same wall.
      await notifyInsufficientFunds(
        pair,
        error.available,
        error.required,
        error.coin
      );
      return failedRow;
    }

    if (
      error instanceof ExchangeClientError ||
      error instanceof ExchangeApiError
    ) {
      return failedRow;
    }
    throw error;
  }
```

- [ ] **Step 6: Type-check the bot package**

Run: `pnpm --filter @dca/bot typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/strategy.ts
git commit -m "Wire auto-transfer wrappers into DCA, run-now, and test orders"
```

---

### Task 6: End-to-end manual verification

**Files:** No code changes. This task is a verification gate before declaring the feature done.

The bot needs a running Postgres + Redis to boot. If you cannot run the bot locally, the controller will deploy the branch to staging/prod and run the checks there.

- [ ] **Step 1: Run the workspace typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 2: Build everything**

Run: `pnpm build`
Expected: exits 0. `apps/bot/dist/` regenerates with the new code.

- [ ] **Step 3: Build the Docker images**

Run:

```bash
docker build -q -t dca-bot:autotransfer-test -f apps/bot/Dockerfile .
docker build -q -t dca-web:autotransfer-test -f apps/web/Dockerfile .
```

Expected: both succeed. No new env vars or runtime deps were introduced.

- [ ] **Step 4: Verify the happy path (Spot empty, Funding full)**

After deploying the branch:

1. Confirm via Bybit UI that BRL is in **Funding**, not Spot.
2. Fire a small test order from the admin dashboard: **TestOrderCard → Execute**.
3. Watch the bot logs (`docker logs -f dcacryptobot-app-oiiyui-bot-1 | grep -E 'Auto-transfer|test order'`):
   - A `Fetched spot balance` line shows ~0.
   - A `Fetched funding balance` line shows the deposit.
   - An `Auto-transfer Funding→Spot` line shows the moved amount + transferId.
   - The test order proceeds normally and reports filled.
4. Confirm a **"Funds Topped Up"** Telegram message arrives, followed by the standard **"BTC Purchased"** message.

- [ ] **Step 5: Verify the skip path (Spot already funded)**

1. Confirm via Bybit UI that BRL is in **Spot** (move some over manually so Spot ≥ `TEST_ORDER_AMOUNT_BRL × 1.1`).
2. Fire another test order.
3. Bot logs show `Fetched spot balance` and a normal order flow. **No** `Auto-transfer` log line. **No** "Funds Topped Up" Telegram.

- [ ] **Step 6: Verify the hard-fail path (Spot + Funding both low)**

⚠️ This step requires withdrawing BRL from Bybit. Only run if comfortable with that — otherwise skip and document this gap as covered by deploy-time monitoring.

1. Withdraw all but ~10 BRL of BRL from both wallets.
2. Fire a test order (50 BRL).
3. Order fails. Bot logs show an `Insufficient BRL balance` error. Telegram receives the **⚠️ INSUFFICIENT FUNDS** alert.
4. Deposit BRL back to Funding.
5. Click **Run now** in the dashboard — the next attempt auto-transfers and succeeds.

- [ ] **Step 7: Confirm Bybit ledger reflects the transfers**

In Bybit UI → **Assets → Transaction History → Internal Transfer**, the two test transfers from Steps 4 and 6 (post-recovery) should appear with their `transferId`s matching the bot's log lines.

- [ ] **Step 8: Final commit (only if any leftover cleanup)**

If Steps 1–7 surfaced any small fix, commit it now with a descriptive message. Otherwise this task is done with no additional commit.

---

## Out-of-scope reminders

Do **not**, as part of this PR:

- Persist transfers to the database. Audit lives in logs + Telegram.
- Auto-transfer in the reverse direction (Spot → Funding).
- Generalize to non-BRL coins.
- Add a dashboard widget showing live wallet balances.
- Make the buffer percentage configurable (it's a hardcoded 10%).
- Sweep Spot at bot boot (the hybrid model covers boot-time deficiencies on the next DCA).
- Change the `nonRetryable` list in `exchange.ts`. `170131` stays non-retryable; the auto-transfer wrappers catch it explicitly at the strategy layer.

---

## Self-review notes (for the implementer)

- `ensureSpotBalance` is module-private behavior with respect to retries — the wrapper at the strategy layer handles the reactive retry. Do not stack retries inside `balance.ts` itself.
- `InsufficientFundsError` extends `ExchangeClientError`. This is intentional: the strategy's existing `instanceof ExchangeClientError → UnrecoverableError` path still works, while the `instanceof InsufficientFundsError` check (ordered first in the new catch) lets us fire a tailored Telegram alert.
- The retry in `placeLimitOrderWithRetry` does NOT re-resolve `qty` or `price`. The strategy already computed them from `currentPrice` and the `tickSize`/`basePrecision`; if Bybit rejected for 170131 specifically, the original `qty`/`price` are still valid. If Bybit also moved tick size between the two attempts, that's a different error code (170134) and is handled by the existing `ExchangeClientError → UnrecoverableError` path.
- `crypto.randomUUID()` is a global on Node ≥14.17. Confirm the project's Node version via `apps/bot/Dockerfile` (uses Node 24-alpine) before assuming this works in CI — it does.
- The `inflight` map in `balance.ts` uses `try/finally` to guarantee deletion even on error. This matches the priceCache.ts pattern.
- `targetAmount = deficit * 1.1` then `transferAmount = Math.min(targetAmount, funding)`. The `min` cap exists so we never request more than Funding holds — Bybit would reject the transfer, and we'd unnecessarily fail. The hard-fail check happens earlier (`spot + funding < required`).
- The `safeAsync` wrapper around `notifyInsufficientFunds` makes it `await`-safe inside the strategy's catch block — even if Telegram is down, the `notifyInsufficientFunds` returns a resolved Promise and the strategy proceeds to `throw new UnrecoverableError`.
