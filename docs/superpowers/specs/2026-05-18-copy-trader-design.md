# Copy-Trader Design

**Date:** 2026-05-18
**Status:** Design approved, awaiting implementation plan
**Author:** Luan (with Claude as collaborator)

---

## 1. Purpose

Add an automated copy-trading capability that consumes futures signals from a private Telegram channel and executes them on a dedicated Bybit sub-account, while keeping the existing DCA bot's spot operations completely isolated.

The signaler posts trades with consistent structure: direction, symbol, entry range, stop loss, leverage, three take-profit levels. Example:

```
SHORT BTC 🔽
Entrada: 79.400 - 79.900
SL: 83.000
Alavancagem: 15x - 20x
TP1: 76400
TP2: 73.850
TP3: 70.800
Ordem ativa já preenchida
```

Goal: parse each signal, evaluate it against safety gates, and execute on Bybit perpetual futures with risk-controlled position sizing — all without user intervention once the bot is live, but with multiple defensive layers to limit blast radius.

---

## 2. Scope

### In scope

- A new Node service `apps/copy-trader` in the existing monorepo
- MTProto user-session listener on the private Telegram channel `-1002427024288`
- Signal parser (regex + Zod validation)
- Risk gate (8 guardrails)
- Bybit V5 perpetual (linear) executor with risk-based position sizing
- Position watcher (BullMQ repeatable job) for fill detection and PnL recording
- Postgres schema `copy_trader` in the existing instance
- Dashboard tab in the existing `apps/web` showing signals, trades, stats, config, kill switch
- Telegram notifications for every state transition
- Three-phase delivery: F0 listener-only → F1 dry-run → F2 live

### Out of scope (P2+)

- Multi-channel listening (only this one channel)
- Multi-TP execution with partials (only TP1, close 100%)
- LLM fallback parser (regex only in MVP)
- Backtesting harness against historical signals
- Auto-tuning of risk parameters
- Web push / mobile app notifications
- Margin mode other than ISOLATED
- Cross-margin sharing with DCA spot

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Telegram canal -1002427024288 (MTProto user session)       │
└─────────────────────┬───────────────────────────────────────┘
                      │ NewMessage event (gramjs)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/copy-trader (Node, Fastify+BullMQ, port 3001)         │
│                                                              │
│  ┌──────────┐   ┌────────┐   ┌──────────┐   ┌─────────┐    │
│  │ Listener │──▶│ Parser │──▶│ Risk Gate│──▶│ Executor│    │
│  └──────────┘   └────────┘   └──────────┘   └─────────┘    │
│       │              │             │              │         │
│       ▼              ▼             ▼              ▼         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Postgres schema copy_trader                         │   │
│  │ signals, trades, daily_stats, system_state, config  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────┐    ┌──────────────────┐              │
│  │ Position Watcher │    │ Telegram Notifier│              │
│  │ (BullMQ repeat)  │    │ (fire & forget)  │              │
│  └──────────────────┘    └──────────────────┘              │
└─────────────────────────────────────────────────────────────┘
                      │ HTTP /api/copy/*
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/web (existing dashboard, new tab /copy)               │
│  nginx proxy /api/copy/* → copy-trader:3001                 │
└─────────────────────────────────────────────────────────────┘
```

### Key architectural decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Process model | New Node service, isolated from `apps/bot` | Crash isolation; principle #5 of CLAUDE.md (bot internal-only); independent deploy |
| Telegram client | gramjs (TypeScript) | Stack consistency with monorepo; avoids new Python runtime |
| Persistence | Postgres schema separation, same instance | Reuses infra; clean isolation; cross-schema joins available for dashboard |
| Bybit account | Dedicated sub-account | Liquidation cannot touch DCA spot holdings |
| Position sizing | Fixed risk % of capital | Industry-standard risk management; position size derived from SL distance |
| Multi-TP handling | Single TP at TP1, 100% close | Simpler MVP; conservative |
| Entry strategy | Market if in range, limit chase if within tolerance | Captures most signals without paying full slippage |
| Leverage policy | `min(signal_leverage, 10)` | Keeps liquidation farther than SL; protects risk model |
| Execution mode | Full auto, no manual approval | User explicitly requested; guardrails compensate |
| Margin mode | ISOLATED | Per-trade blast radius limited to posted margin |
| Monitoring | Dashboard tab + Telegram | Visual history + push alerts |

---

## 4. Components

### 4.1 Listener (`listener.ts`)

- Uses `telegram` (gramjs) with `StringSession`
- Subscribes to channel `SIGNAL_CHANNEL_ID` via `NewMessage` event filter
- Auto-reconnect built-in; heartbeat log every 60s
- On boot reconcile: reads last 50 channel messages and reprocesses those whose `signal_hash` is not already in `signals`
- On session expiry (`AUTH_KEY_INVALID`): logs fatal, sends critical Telegram alert, listener stays down until operator runs `pnpm copy-trader:auth` and redeploys with new session string

### 4.2 Parser (`parser.ts`)

Output type:

```typescript
type SignalIntent = {
  direction: "LONG" | "SHORT";
  symbol: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  leverageRaw: number;
  takeProfit1: number;
  takeProfit2?: number;
  takeProfit3?: number;
  rawText: string;
  signalHash: string;
};
```

Strategy:

1. Regex to capture base structure: `/^(?:#\w+\s+)?(LONG|SHORT)\s+(\w+)/m`
2. Text normalizer: fixes `0. 0.00385` typo, dedupes repeated TP labels (e.g. `TP3` appearing twice in BTC short example), normalizes BR thousand separators (`79.400` → `79400`)
3. Symbol mapping: `BTC` → `BTCUSDT`, `1000PEPE` → `1000PEPEUSDT` (static lookup table; instrument validity confirmed against Bybit `getInstrumentInfo` on boot)
4. Zod schema validation: rejects on missing required field or directional contradiction (LONG with SL above entry, SHORT with SL below entry)
5. If parse fails: insert row with `status='UNPARSEABLE'`, send Telegram warning with raw text + msg link, do not proceed

### 4.3 Risk Gate (`riskGate.ts`)

Returns `GateResult = { ok: true, ... } | { ok: false, reason: string, meta?: object }`. Evaluates gates in order, short-circuits on first fail.

| Gate | Default | Notes |
|------|---------|-------|
| G1 Kill switch | `killed=false` | Reads `system_state.killed`. Reset only via admin endpoint or SQL |
| G2 Duplicate signal | — | SQL `UNIQUE(signal_hash)` race-safe |
| G3 Whitelist symbols | `BTCUSDT,ETHUSDT` | csv in `config`; signals for non-whitelisted pairs auto-skip |
| G4 Cooldown after loss | 30 min | `system_state.cooldown_until` set by watcher on negative-PnL close |
| G5 Max open positions | 3 | Counts both `OPEN` and `PENDING_FILL` |
| G6 Daily loss limit | 10% of `balance_start` | Resets at 00:00 UTC; `balance_start` snapshot lazily |
| G7 Max drawdown | 30% of `initial_capital` | Triggers permanent kill switch + critical Telegram alert |
| G8 Price in chase range | `±0.5%` tolerance | Returns `entryStyle: MARKET\|LIMIT_CHASE` + `limitPrice` |

Pre-execution sanity (not a gate, hard errors if violated):

- Directional coherence: LONG SL must be below entry; SHORT SL above
- TP1 must be in the profitable direction
- Minimum reward:risk ratio `MIN_RR_RATIO=0.5` (rejects malformed signals)

### 4.4 Executor (`executor.ts`)

Sequence on gate-pass:

1. Set leverage via `POST /v5/position/set-leverage` to `min(signal.leverageRaw, MAX_LEVERAGE)`. `retCode=110043` (not modified) treated as success.
2. Ensure margin mode `ISOLATED` for the symbol via `POST /v5/position/switch-isolated` (per-symbol on Unified Trading Account). Cached in-memory after first call per symbol to avoid repeated network round-trips. `retCode=110026` (margin mode not modified) treated as success.
3. Compute position size:
   ```
   balance         = bybit.getBalance()  // USDT in sub-account
   risk_usdt       = balance * MAX_RISK_PCT / 100
   sl_distance_pct = abs(entry - SL) / entry
   position_usdt   = risk_usdt / sl_distance_pct
   qty             = position_usdt / entry_price  // quantized to symbol lotSize
   ```
4. Generate `orderLinkId = "copy-{signal_hash[:16]}"` (client-side idempotency token).
5. Branch on `DRY_RUN`:
   - **Dry-run path:** insert `trades` row with `dry_run=true`, `status='DRY_RUN_LOGGED'`, `bybit_order_id=NULL`, all planned values populated. Telegram notifies `DRY: would execute ...`. No Bybit call.
   - **Live path:** call `POST /v5/order/create` with `category=linear`, `orderType=Market|Limit`, `takeProfit=TP1`, `stopLoss=SL`, `tpslMode=Full`, `orderLinkId`. Insert `trades` row with `dry_run=false`, `status='PENDING_FILL'`, planned values, `bybit_order_id` from response.
6. Update `signals.status='EXECUTED'`, set `trade_id`.
7. Fire Telegram notification.

If Bybit returns retryable error (`ExchangeApiError`): exponential backoff 2s/8s/30s, max 3 attempts.
If non-retryable (`ExchangeClientError`): mark `trades.status='ERROR'`, alert.
If response lost (timeout after submit): watcher reconciles via `orderLinkId` within 60s.

### 4.5 Position Watcher (`watcher.ts`)

BullMQ repeatable job every 30s. **Only processes trades with `dry_run = false`.** Dry-run trades are inserted with `status='DRY_RUN_LOGGED'` and never touch the watcher.

For each `dry_run=false` trade with `status` in `PENDING_FILL` or `OPEN`:

- Fetch `GET /v5/order/realtime` (open orders) and `GET /v5/position/list` (current positions)
- Reconcile state transitions:
  - `PENDING_FILL` + order filled → `OPEN`, persist `filled_qty`, `avg_entry`, `fill_ts`
  - `PENDING_FILL` + order cancelled (limit expired) → `NOT_FILLED`
  - `OPEN` + `position.size == 0` → look up close reason via `GET /v5/execution/list`:
    - Filled at TP price → `CLOSED_TP`
    - Filled at SL price → `CLOSED_SL`
    - Filled at liquidation price → `LIQUIDATED`
    - Other → `CLOSED_MANUAL`
  - Compute realized PnL from Bybit's reported `closedPnl` (source of truth, not client-side calc)
- Update `daily_stats.pnl_usdt` and `trades_closed`
- On negative PnL: set `system_state.cooldown_until = now + COOLDOWN_MIN_AFTER_LOSS`
- After update, check G7 (drawdown) and trip kill switch if breached
- Telegram notify each transition

### 4.6 Telegram Notifier (`notifications.ts`)

Reuses pattern from `apps/bot/src/notifications.ts`. Fire-and-forget — errors logged but never propagate. Separate bot token from DCA's, but can be the same chat ID.

Message templates:

| Event | Template |
|-------|----------|
| Signal parsed OK | `📥 Signal: {direction} {symbol} @ {entryLow}-{entryHigh}, SL {sl}, TP1 {tp1}` |
| Signal unparseable | `⚠️ Unparseable signal — review: {msg_link}` |
| Skip | `⏭️ Skipped {direction} {symbol} — {reason}` |
| Execute | `✅ Executed {direction} {symbol} {qty} @ ~{entry}, SL {sl}, TP {tp}, lev {lev}x` |
| Fill | `🟢 Filled {symbol} @ {avg_entry}` |
| TP hit | `✅ TP {symbol} +{pnl} USDT` |
| SL hit | `🔴 SL {symbol} -{pnl} USDT` |
| Liquidation | `💀 LIQUIDATED {symbol} {pnl} USDT` |
| Cooldown set | `❄️ Cooldown until {time} (after loss)` |
| Daily loss limit | `🛑 Daily loss limit hit ({lossPct}%) — pausing until 00:00 UTC` |
| Kill switch | `🚨 KILL SWITCH — reason: {reason}. Bot stopped.` |
| Auth error | `🚨 Bybit auth invalid — investigate immediately` |
| Telegram session expired | `🚨 Telegram session invalid — run pnpm copy-trader:auth` |

### 4.7 HTTP Server (`server.ts`)

Fastify on port 3001, internal only.

Routes:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health/live` | none | Liveness |
| GET | `/health/ready` | none | DB + Redis + Bybit connectivity |
| GET | `/api/copy/signals` | admin JWT | Paginated signals with status |
| GET | `/api/copy/trades` | admin JWT | Paginated trades |
| GET | `/api/copy/stats` | admin JWT | Aggregate: total PnL, win rate, drawdown, today's PnL |
| GET | `/api/copy/system-state` | admin JWT | killed, cooldown, initial_capital |
| GET | `/api/copy/config` | admin JWT | Current config table contents |
| PUT | `/api/copy/config/:key` | admin JWT | Update one config key (validated range) |
| POST | `/api/copy/admin/reset-kill-switch` | admin JWT | Re-enable bot after manual review |
| POST | `/api/copy/admin/kill` | admin JWT | Manual kill switch trigger |

Uses the same JWT auth pattern as `apps/bot/src/server.ts`. JWT secret shared via env.

### 4.8 Dashboard (`apps/web/src/pages/CopyTraderPage.tsx`)

New tab on existing dashboard at route `/copy`. Components:

- `KillSwitchPanel` — big red status pill if killed, current cooldown, initial capital, current balance, drawdown %
- `StatsCard` — today's PnL, 7d PnL, all-time PnL, win rate, count by close reason
- `TradesTable` — paginated, filterable by status, sortable by date/PnL
- `SignalsTable` — paginated, shows raw + parsed, filterable by status (especially `UNPARSEABLE`)
- `ConfigForm` — editable table of config keys with validated inputs

TanStack Query for all data; same pattern as DCA dashboard.

---

## 5. Data Model

Schema `copy_trader` in the existing Postgres instance.

```sql
CREATE SCHEMA copy_trader;

-- 1. signals (no FK to trades yet — added after trades exists)
CREATE TABLE copy_trader.signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_hash     TEXT NOT NULL UNIQUE,
  raw_text        TEXT NOT NULL,
  telegram_msg_id BIGINT NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  direction       TEXT,
  symbol          TEXT,
  entry_low       NUMERIC(20, 8),
  entry_high      NUMERIC(20, 8),
  stop_loss       NUMERIC(20, 8),
  leverage_raw    INTEGER,
  take_profit_1   NUMERIC(20, 8),
  take_profit_2   NUMERIC(20, 8),
  take_profit_3   NUMERIC(20, 8),
  status          TEXT NOT NULL,
  skip_reason     TEXT,
  trade_id        UUID,                          -- FK added later
  CONSTRAINT signals_status_check CHECK (
    status IN ('PARSED','UNPARSEABLE','SKIPPED','EXECUTED')
  )
);
CREATE INDEX ON copy_trader.signals (received_at DESC);
CREATE INDEX ON copy_trader.signals (status);

-- 2. trades
CREATE TABLE copy_trader.trades (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           UUID NOT NULL REFERENCES copy_trader.signals(id),
  symbol              TEXT NOT NULL,
  direction           TEXT NOT NULL,
  bybit_order_id      TEXT,                       -- null for dry-run
  bybit_order_link_id TEXT NOT NULL UNIQUE,
  bybit_position_idx  INTEGER NOT NULL DEFAULT 0, -- one-way mode (hedge mode out of scope)
  planned_qty         NUMERIC(20, 8) NOT NULL,
  planned_margin      NUMERIC(20, 8) NOT NULL,
  leverage_used       INTEGER NOT NULL,
  entry_strategy      TEXT NOT NULL,
  limit_price         NUMERIC(20, 8),
  limit_expires_at    TIMESTAMPTZ,
  filled_qty          NUMERIC(20, 8),
  avg_entry           NUMERIC(20, 8),
  fill_ts             TIMESTAMPTZ,
  tp_price            NUMERIC(20, 8) NOT NULL,
  sl_price            NUMERIC(20, 8) NOT NULL,
  status              TEXT NOT NULL,
  close_reason        TEXT,
  exit_price          NUMERIC(20, 8),
  close_ts            TIMESTAMPTZ,
  pnl_usdt            NUMERIC(20, 8),
  fees_usdt           NUMERIC(20, 8),
  error_message       TEXT,
  dry_run             BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trades_status_check CHECK (
    status IN ('DRY_RUN_LOGGED','PENDING_FILL','OPEN','NOT_FILLED','CLOSED_TP','CLOSED_SL','CLOSED_MANUAL','LIQUIDATED','ERROR')
  ),
  CONSTRAINT trades_entry_strategy_check CHECK (
    entry_strategy IN ('MARKET','LIMIT_CHASE')
  )
);
CREATE INDEX ON copy_trader.trades (status);
CREATE INDEX ON copy_trader.trades (signal_id);
CREATE INDEX ON copy_trader.trades (created_at DESC);

-- 3. add deferred FK from signals.trade_id → trades.id
ALTER TABLE copy_trader.signals
  ADD CONSTRAINT signals_trade_id_fkey
  FOREIGN KEY (trade_id) REFERENCES copy_trader.trades(id);

CREATE TABLE copy_trader.daily_stats (
  day             DATE PRIMARY KEY,
  trades_opened   INTEGER NOT NULL DEFAULT 0,
  trades_closed   INTEGER NOT NULL DEFAULT 0,
  pnl_usdt        NUMERIC(20, 8) NOT NULL DEFAULT 0,
  balance_start   NUMERIC(20, 8),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE copy_trader.system_state (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  killed          BOOLEAN NOT NULL DEFAULT false,
  killed_reason   TEXT,
  killed_at       TIMESTAMPTZ,
  cooldown_until  TIMESTAMPTZ,
  cooldown_reason TEXT,
  initial_capital NUMERIC(20, 8),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO copy_trader.system_state (id) VALUES (1);

CREATE TABLE copy_trader.config (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Drizzle migrations live in `apps/copy-trader/drizzle/migrations/` (separate from `apps/bot/drizzle/`).

---

## 6. Configuration

### Env vars (validated by Zod in `apps/copy-trader/src/config.ts`)

```bash
# Telegram MTProto (NOT bot token)
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_SESSION_STRING=
SIGNAL_CHANNEL_ID=-1002427024288

# Bybit (sub-account, SEPARATE from DCA)
BYBIT_API_KEY=
BYBIT_API_SECRET=
BYBIT_TESTNET=false
BYBIT_CATEGORY=linear

# Postgres
DATABASE_URL=
DATABASE_SCHEMA=copy_trader

# Redis (same instance as bot, separate queue prefix)
REDIS_URL=

# Telegram notify
TELEGRAM_NOTIFY_BOT_TOKEN=
TELEGRAM_NOTIFY_CHAT_ID=

# Auth (shared JWT secret with bot for dashboard SSO)
JWT_SECRET=

# Operation
PORT=3001
LOG_LEVEL=info
NODE_ENV=production

# Bootstrap
INITIAL_CAPITAL_USDT_OVERRIDE=
```

### Mutable config (DB `copy_trader.config`)

| Key | Default | Valid range | Meaning |
|-----|---------|-------------|---------|
| `MAX_RISK_PCT` | `2.0` | 0.1–5.0 | % of balance lost if SL hits |
| `MAX_LEVERAGE` | `10` | 1–20 | Leverage cap applied |
| `MAX_OPEN_POSITIONS` | `3` | 1–10 | Concurrent trades cap |
| `DAILY_LOSS_LIMIT_PCT` | `10.0` | 1–50 | % of day-start balance that pauses until 00:00 UTC |
| `MAX_DRAWDOWN_PCT` | `30.0` | 5–80 | % of initial capital that trips kill switch |
| `COOLDOWN_MIN_AFTER_LOSS` | `30` | 0–1440 | Minutes paused after any losing trade |
| `CHASE_TOLERANCE_PCT` | `0.5` | 0–5 | % outside range still acceptable with limit chase |
| `CHASE_TIMEOUT_MIN` | `10` | 1–60 | Limit chase lifespan before auto-cancel |
| `MIN_RR_RATIO` | `0.5` | 0.1–10 | Minimum reward:risk to TP1 |
| `WHITELIST_SYMBOLS` | `BTCUSDT,ETHUSDT` | csv | Approved instruments |
| `DRY_RUN` | `true` | bool | Plans but does not call Bybit order/create |

---

## 7. Error Handling

### Error taxonomy

```typescript
class ExchangeApiError extends Error { constructor(msg: string, public retCode?: number) }
class ExchangeClientError extends Error { constructor(msg: string, public retCode?: number) }
class UnparseableSignalError extends Error {}
```

`ExchangeApiError` is retryable (5xx, network, 429). `ExchangeClientError` is not (4xx, auth, insufficient balance).

### Retry policy

- Bybit calls: exponential backoff 2s/8s/30s, max 3 attempts on `ExchangeApiError`
- Rate-limit (429): respect `X-Bapi-Limit-Reset-Timestamp` header
- After 3 retries failed: mark `trades.status='ERROR'`, log error, Telegram alert

### Automatic kill switch triggers

1. Drawdown ≥ `MAX_DRAWDOWN_PCT`
2. 3+ consecutive `ERROR` trades within 1 hour
3. Repeated auth failures (`retCode=10006`)

All trigger `killed=true` + critical Telegram + service stays up but rejects all new signals.

### Boot recovery

Boot sequence in `index.ts`:

1. Validate env (Zod)
2. Run Drizzle migrations
3. Seed `config` defaults if empty
4. Read `system_state` — if `killed`, log warning, **do not** start listener, but start Fastify server so dashboard remains queryable
5. Reconcile orphan trades: for each `PENDING_FILL` or `OPEN` trade, fetch state from Bybit and call same reconciliation logic as the watcher
6. Listener boot reconcile: read last 50 channel messages, process novel `signal_hash` values
7. Start watcher (BullMQ repeatable)
8. Start Fastify server on port 3001

---

## 8. Testing Strategy

Stack: Vitest, `vi.mock()` for HTTP, Postgres test container for integration tests.

| Layer | Coverage target | Examples |
|-------|----------------|----------|
| Unit — parser | ~100% | Three reference signals from spec + variants (typo `0. 0.00385`, duplicated TP3, no `#tag`, BR thousands `79.400`, different symbols) |
| Unit — sizing | ~100% | Risk-fixed % across SL distances, lotSize quantization, edge cases (SL very close, balance low, balance zero) |
| Unit — risk gate | ~100% per gate | Each gate isolated with mocked DB |
| Integration — executor | Medium | Mocked Bybit HTTP, asserts payload structure, retry behavior, error mapping |
| Integration — watcher | Medium | Mocked Bybit responses, simulates state transitions, asserts `daily_stats` updates and cooldown triggers |
| E2E — dry run | Manual | Inject fake signal, validate planning but no order placed |
| E2E — testnet | Manual | Inject fake signal on Bybit testnet, validate end-to-end (order created, watcher detects close) |

CI: new GitHub Actions workflow `copy-trader.yml`, runs `pnpm --filter @dca/copy-trader test`. PR-blocking.

---

## 9. Phased Delivery

### F0 — Listener-only

**Build (estimate 2–3 days):**

- Scaffold `apps/copy-trader/` with: config, logger, db client, listener, parser, notifier, minimal Fastify server
- Single Drizzle migration creates **all 5 tables** at once (`signals`, `trades`, `daily_stats`, `system_state`, `config`). F0 only writes to `signals`; the rest sit empty until F1. Avoids a follow-up migration when F1 lands.
- `pnpm copy-trader:auth` script to generate `TELEGRAM_SESSION_STRING`
- Dockerfile, docker-compose entry, Dokploy deploy
- Dashboard tab with one view: `signals` table (raw, status, parsed fields)
- Telegram notify for each signal (parsed OK or unparseable)

**Validation window (1–2 weeks):**

- Collect real signals
- Manually review unparseable entries; iterate on regex
- Advancement criterion: ≥95% parse success rate, all known formats handled

### F1 — Dry-run

**Build (estimate 4–5 days):**

- Add `riskGate.ts`, `executor.ts` (dry-run branch + live branch), `watcher.ts`, `bybit.ts`
- Tables already exist from F0; seed `config` defaults if not present; populate `system_state.initial_capital` on first boot
- Create Bybit sub-account; generate API key with derivatives + read permissions only (no withdrawal)
- Set `BYBIT_TESTNET=true` initially with testnet API key; flip to mainnet only after green E2E run
- Executor's dry-run branch inserts `trades` row with `status='DRY_RUN_LOGGED'` (no Bybit call)
- Watcher only processes `dry_run=false` trades; dry-run rows are end-state at insert time
- Integration tests (Vitest) exercise watcher's transition logic against mocked Bybit responses — this is the test harness, not production behavior
- Dashboard expands: trades table, stats card, config form
- Telegram notify: `DRY: would execute ...`

**Validation window (2 weeks):**

- Zero planning errors
- Sizing math manually validated on ≥10 trades
- All 8 gates exercised at least once
- Advancement criterion: above + operator manually approves transition

### F2 — Live

**Cutover (estimate 2 days):**

- Flip `BYBIT_TESTNET=false`, ensure real sub-account funded (e.g. 100 USDT initial)
- Flip `DRY_RUN=false` via dashboard config endpoint
- Watcher makes real Bybit calls
- Kill switch armed at `MAX_DRAWDOWN_PCT=30%`

**Monitoring (continuous, first week intensive):**

- Operator reviews every trade
- Critical Telegram alerts for `ERROR` or kill switch
- After 2–4 weeks stable: scale capital or expand whitelist

---

## 10. Deployment

### Monorepo changes

```
apps/copy-trader/                  # new
  src/
    index.ts
    config.ts
    logger.ts
    listener.ts
    parser.ts
    riskGate.ts
    executor.ts
    watcher.ts
    notifications.ts
    server.ts
    bybit.ts
    configStore.ts
    recovery.ts
    db/
      client.ts
      schema.ts
      seed.ts
    scripts/
      auth.ts                       # CLI for generating session string
  drizzle/migrations/
  Dockerfile
  package.json
  tsconfig.json

packages/shared/src/index.ts        # add CopySignal, CopyTrade, CopyStats, CopySystemState, CopyConfig types

apps/web/src/                       # add
  pages/CopyTraderPage.tsx
  components/copy/
    KillSwitchPanel.tsx
    StatsCard.tsx
    TradesTable.tsx
    SignalsTable.tsx
    ConfigForm.tsx
  lib/api.ts                        # extend with /api/copy/* hooks

apps/web/nginx.conf                 # add location /api/copy/ → copy-trader:3001
docker-compose.yml                  # add copy-trader service, expose 3001, no ports
.env.example                        # add new env vars

.github/workflows/copy-trader.yml   # new CI workflow
```

### Secrets

All credentials (Telegram api/hash/session, Bybit api key/secret, JWT secret, Telegram notify bot token) live in Dokploy environment configuration. Never committed.

`TELEGRAM_SESSION_STRING` is generated locally via `pnpm copy-trader:auth`, then pasted into Dokploy. Treat as full account credential — rotate on any suspicion of leak.

---

## 11. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Telegram TOS — user-bots may be banned | Passive use only (read); secondary account recommended |
| Session string leak compromises full Telegram account | Dokploy secrets; never logged; never committed; rotate on suspicion |
| Signaler disappears or changes format | Parser falls back to UNPARSEABLE; operator review; manual kill available |
| Bybit V5 API change | Watcher detects errors, alerts; pinned SDK version; integration tests catch breaking changes |
| Bybit weekend gap exceeds SL distance | Leverage cap 10x leaves liquidation farther than SL, providing buffer |
| Duplicate-signal race (listener reconnect) | `signals.signal_hash UNIQUE` + idempotent `orderLinkId` |
| Cascading losses | Layered defense: cooldown (single loss) → daily loss limit (bad day) → kill switch (catastrophic) |
| Bug in sizing → oversized position | Vitest unit coverage at ~100%; manual review of first 10 dry-run trades; small initial capital in F2 |
| Bot crash during execution | Boot recovery reconciles `PENDING_FILL`/`OPEN` trades via Bybit |
| Dashboard shows stale state | TanStack Query polls every 10–30s like DCA dashboard |

---

## 12. Open questions / decisions deferred

- **Symbol mapping coverage:** static lookup table covers BTC, ETH, 1000PEPE for MVP. As signaler introduces new symbols, parser will mark them `UNPARSEABLE`; operator extends the lookup. Future P2: fetch all `linear` instruments from Bybit on boot and auto-map by suffix matching.
- **Telegram notify bot:** dedicated bot token + dedicated chat (or same chat with topic separation). Decided: dedicated bot for clean visual separation from DCA messages.
- **Test order isolation in dashboard:** copy-trader has no notion of `is_test`. All trades are real (or dry-run). The DCA bot's `is_test` column is unrelated.
