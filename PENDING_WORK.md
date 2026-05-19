# Pending Work

Status snapshot as of 2026-05-18. Picks up where the F0 + F1 deploy +
MVC refactor left off. Read top-to-bottom; sections are ordered by
urgency.

---

## 0. Current state

**Production:**
- DCA bot (`apps/bot`) — running, Sunday 08:00 UTC weekly buy, BTCBRL spot.
- Copy-trader F0 (listener) — running, ingesting Mack's signals from
  Telegram topic 4 ("Sinais VIP Mack") with sender whitelist
  (`6492923280` = @mack_aqui).
- Copy-trader F1 (dry-run executor + risk gate + watcher) — running with
  `DRY_RUN=true`. No live orders. Will be flipped in F2.

**Architecture:**
- Both apps use clean layered MVC: `routes/` → `controllers/` →
  `services/` → `domain/` → `infra/`.
- Models in `db/` (Drizzle schema).
- Cross-cutting/lifecycle at root: `config`, `logger`, `index`,
  `server`, `recovery`, `queue` (bot), `listener` (copy-trader),
  `paginate` (copy-trader).

**Tests:** copy-trader has 27 unit tests (parser, riskGate, sizing,
executor). Bot has zero (P2 backlog).

---

## 1. SECURITY: Rotate leaked credentials (do this first)

The following credentials appeared in this chat transcript (you pasted
them directly during initial setup, and Dokploy MCP returned the full
env block when fetching compose-one). Rotate in this order:

### 1.1 Telegram MTProto session string (critical)

`COPY_TG_SESSION_STRING` = `1AQAOMTQ5LjE1NC4xNzUuNTk...` (full string in
Dokploy env)

**Risk:** Full control of your Telegram account — anyone with this can
read every chat, send messages as you, list contacts.

**Rotate:**
1. Telegram app → Settings → Devices → revoke the session (look for
   the active "Telegram Desktop / API" entry from VPS IP `69.62.100.241`).
2. Generate new locally:
   ```bash
   cd apps/copy-trader
   TELEGRAM_API_ID=36016803 TELEGRAM_API_HASH=0e04e177b1144f6c3c524cdb09ba7488 pnpm auth
   ```
3. Paste output into Dokploy → project `dca-crypto-bot` → service
   `app` → env var `COPY_TG_SESSION_STRING`.
4. Redeploy.

### 1.2 Bybit DCA-bot API key (high)

`BYBIT_API_KEY` = `R5WEYJUeGivf5P5GQI`
`BYBIT_API_SECRET` = `qS0WYBNqNnaPxHw0SHbBnjN0umnOIl7ez6mj`

**Risk:** Depends on key permissions. If Spot Read & Trade only (no
withdraw), attacker can move your spot balance but not exit funds.

**Rotate:**
1. Bybit web → API Management → revoke the key.
2. Create new with permissions: **Spot Trading** (Read & Trade only),
   **no Withdrawal**, **no Derivatives**.
3. Optional: IP-restrict to `69.62.100.241` (VPS).
4. Update `BYBIT_API_KEY` + `BYBIT_API_SECRET` in Dokploy → redeploy.

### 1.3 Telegram bot tokens (medium)

`TELEGRAM_BOT_TOKEN` (DCA notify) = `8690663706:AAGR99wwDzGgjCNxBNA59ddWD-oCPLn2KP0`
`COPY_NOTIFY_BOT_TOKEN` (copy-trader notify) = `8866692903:AAF9mEKH1Qg7QmRaYQHB6IAqPxIDJ-ax8FE`

**Risk:** Low — bot can only message you. Worst case: spam your chat.

**Rotate (each):**
1. @BotFather → `/revoke` → choose bot → confirm.
2. `/token` to get new token.
3. Update env in Dokploy → redeploy.

### 1.4 JWT secret (medium)

`JWT_SECRET` = `4abff421f375290df7be3a322a34ecd77a32c23236eb24d1a8acd14646766fa1`

**Risk:** Attacker can forge admin JWT → full dashboard access (run
test orders, edit config, kill switch).

**Rotate:**
1. Generate new: `openssl rand -hex 32`
2. Update in Dokploy → redeploy.
3. All existing sessions invalidate — log in again.

### 1.5 Admin password (medium)

`ADMIN_PASSWORD` = `Radask13@1535xD`

**Rotate:** Change to new strong password in Dokploy → redeploy. Login
flow already uses bcrypt cost 12.

### 1.6 Postgres password (low, more coordination)

`POSTGRES_PASSWORD` = `192ad6733bc367f287905ccce2614894e39417559d7840a99fd9c9863ba4b0b7`

**Risk:** Low — Postgres is behind dokploy-network, no external port.
Only matters if attacker is already inside the VPS.

**Rotate (if doing thorough cleanup):**
1. Choose new password.
2. SSH to VPS, run inside postgres container:
   ```sql
   ALTER USER dca WITH PASSWORD '<new>';
   ```
3. Update `POSTGRES_PASSWORD` in Dokploy → redeploy. Both bot and
   copy-trader containers reconnect.

---

## 2. Bybit sub-account setup for F1 dry-run validation

F1 ships with `DRY_RUN=true` and empty `COPY_BYBIT_API_KEY` —
executor logs planned trades but `balanceUsdt` falls back to
`initialCapital` (currently 0), so sizing rejects with
`BALANCE_TOO_SMALL`. To get meaningful dry-run plans against real
numbers:

### 2.1 Create sub-account

1. Bybit web → Settings → Sub-Accounts → Create.
2. Type: **Unified Trading Account**.
3. Name: `copy-trader-mack` (or whatever).

### 2.2 Generate API key under sub-account

1. Sub-account → API Management → Create.
2. Permissions: **Derivatives → Read & Trade** only.
3. Disable Withdrawal, disable Spot trading.
4. IP-restrict to `69.62.100.241` (recommended).
5. Save key + secret.

### 2.3 Fund sub-account

Transfer ~50 USDT to the sub-account's Unified Trading wallet.
Bybit web → Transfer → from main → to sub-account.

### 2.4 Wire to Dokploy

In `dca-crypto-bot` → service `app` → environment, set:
- `COPY_BYBIT_API_KEY` = your sub-account API key
- `COPY_BYBIT_API_SECRET` = your sub-account API secret
- `COPY_BYBIT_TESTNET` = `false`
- `COPY_INITIAL_CAPITAL_USDT_OVERRIDE` = leave empty (auto-detected
  from `getWalletBalanceUsdt()` on first boot)

Redeploy. Expected logs:
```
Bybit client initialized hasKey=true
system_state.initial_capital populated capital=50
```

After that, every Mack signal that passes the gate generates a real
`trades` row with `status=DRY_RUN_LOGGED`. The sizing math runs
against the real balance. You can audit `plannedQty`, `plannedMargin`,
`leverageUsed` against:
- risk_usdt = balance × MAX_RISK_PCT
- sl_distance_pct = |entry − SL| / entry
- position_usdt = risk_usdt / sl_distance_pct
- qty = position_usdt / entry, floored to qtyStep

---

## 3. F0 validation window (1-2 weeks, passive)

Goal: ≥95% of format-conformant Mack signals parse cleanly. Catches
parser gaps before F2 ships.

**How to track:**
- Dashboard tab `/copy` → Signals table. Filter by status:
  - `PARSED` → green path, no action.
  - `UNPARSEABLE` → review the raw text. If it's a real signal the
    parser missed, file as a parser bug.
  - `EXECUTED` → a PARSED signal that the F1 executor also processed.
- Telegram bot will alert on every `UNPARSEABLE` that has signal-like
  markers (LONG/SHORT/Entrada/Alavancagem/TP\d/SL).

**Pass criterion:** No `UNPARSEABLE` row that should have been
`PARSED` for 1-2 weeks of operation. If parser misses a real signal,
add it to `apps/copy-trader/src/domain/parser.test.ts` as a failing
test, then patch `parser.ts` until it passes.

---

## 4. F2 plan + execution (after F0 validates)

F2 = flip `DRY_RUN=false` and go live with real orders. Separate plan
that should include:

### 4.1 Pre-flip checklist

- F0 validation criterion met (≥95% parse rate over 1-2 weeks).
- F1 sub-account funded and seeing dry-run rows accumulate.
- `system_state.initial_capital` is populated and matches your
  intended baseline.
- Kill switch armed (`killed=false`) and `MAX_DRAWDOWN_PCT` set to
  something you can live with (currently `30%` default).
- Operator (you) reviewed the `inferCloseInfo` heuristic in
  `apps/copy-trader/src/domain/watcher.ts` — TP/SL classification
  uses 0.5%/1% tolerance windows, may misclassify exotic exits.

### 4.2 Pre-flip code work (Important issues from F1 final review)

These items don't block F1 dry-run but should be fixed before flipping
live. The first is the only critical one — already fixed:

- ✅ `inferCloseInfo` execution scoping by `execTime > fillTs` — already
  patched in commit `a713e32`.
- ⚠️ `signals.status` reaches `EXECUTED` — already patched in same
  commit.
- ⚠️ `insertErrorTrade` links signal → trade — already patched.
- ⚠️ Asymmetric TP/SL inference thresholds (0.5% vs 1%) — review whether
  symmetric is more correct.

### 4.3 Flip procedure

1. In Dokploy dashboard `/copy` → Config form → set `DRY_RUN` to
   `false` → Save.
2. Watcher's next tick (within 30s) picks up the change because the
   service reads `getAllConfig()` per signal, not at boot.
3. Next Mack signal → executor places real order on Bybit.
4. Watcher reconciles fills/closes; PnL accumulates in
   `daily_stats`.

### 4.4 Rollback procedure

- Immediate stop: dashboard → System panel → "Kill now" → all new
  signals rejected by `G1 KILL_SWITCH_ACTIVE` gate.
- Or via SQL: `UPDATE copy_trader.system_state SET killed=true,
  killed_reason='manual rollback' WHERE id=1`.
- Existing open positions on Bybit are NOT closed automatically —
  close manually on Bybit web if needed.

### 4.5 Monitoring during first week live

- Daily review of trades table.
- Telegram alerts for every TP hit, SL hit, liquidation, ERROR.
- Kill switch auto-fires on drawdown ≥ `MAX_DRAWDOWN_PCT` (default
  30%).

---

## 5. Tech debt (not blocking, schedule when convenient)

### 5.1 Bybit HMAC signing dedup

`apps/bot/src/infra/exchange.ts` (DCA spot client) and
`apps/copy-trader/src/infra/bybit.ts` (perp client) share ~90% of the
signing handshake. Candidate extraction to a new
`packages/bybit-auth` package exporting `createSignedAxiosInstance()`.

Cost: ~1 hour. Benefit: single source of truth for clock-skew and
header changes. Wait until a third Bybit client is needed before
extracting.

### 5.2 Logger dedup

`apps/bot/src/logger.ts` and `apps/copy-trader/src/logger.ts` are
identical except for two extra redaction keys in copy-trader. Move
to a shared package (`packages/logger` or break the `types-only`
policy of `packages/shared`).

Cost: ~30 min. Benefit: future redaction key additions stay in sync,
reducing security-leak risk.

### 5.3 Path aliases

Add tsconfig path alias `@/*` → `src/*` so `../../logger.js` from
nested subdirs becomes `@/logger.js`. Reduces noise in
`domain/signals/*.ts` and any other deeply-nested module.

Cost: ~15 min (one-line per tsconfig + global search-and-replace).
Benefit: cosmetic, easier to read.

### 5.4 Bot test coverage

Bot has zero unit tests. CLAUDE.md flags this as P2 backlog. Vitest
harness is already in copy-trader; mirror the config to bot. Start
with high-value pure functions:
- `apps/bot/src/domain/spending.ts` (`getMonthlySpent`)
- `apps/bot/src/domain/strategy.ts` (`signalColumns`, `placeMarketOrderWithRetry`
  retry logic via mocks)
- `apps/bot/src/infra/exchange.ts` (HMAC signature against known fixture)

Cost: ~4-6 hours for meaningful coverage. Benefit: confidence on
strategy changes.

### 5.5 F1 minor — daily balance snapshot

`copy_trader.daily_stats.balance_start` column exists but is never
written. The G5 `DAILY_LOSS_LIMIT_PCT` gate currently uses
`initialCapital` as the day-start baseline, which means the gate
measures lifetime drawdown not daily drawdown.

Fix: add a cron (BullMQ repeatable at 00:00 UTC) that writes the
current Bybit balance to today's `balance_start`. Then update
`executeWithGate` to use `dayBalanceStart =
todayRow?.balanceStart ?? initialCapital`.

Cost: ~30 min. Wait until F2 is live and you've seen a multi-day PnL
swing.

### 5.6 Asymmetric TP/SL inference thresholds

`inferCloseInfo` in watcher uses 0.5% tolerance for TP, 1% for SL.
The asymmetry isn't well-motivated. Consider unified threshold and
explicit tie-break.

Cost: ~15 min. Important before F2 only if first dry-run trades
expose misclassifications.

---

## 6. Quick reference

### 6.1 Repos and paths

- Repo root: `/Users/anlu/www/personal/bybit-dca-bot`
- Apps: `apps/bot` (DCA spot), `apps/copy-trader` (Mack signals),
  `apps/web` (dashboard)
- Shared types: `packages/shared/src/index.ts`
- Docs: `docs/superpowers/{specs,plans}/`

### 6.2 SSH

- Alias: `hostinger-vps` (root@69.62.100.241:22, key
  `~/.ssh/id_ed25519`)
- VPS user: `root`
- Dokploy projects on-disk: `/etc/dokploy/projects/`
- Container logs: `docker logs dcacryptobot-app-oiiyui-<service>-1`

### 6.3 Dokploy

- Project: `dca-crypto-bot` (id: `n2532LJqTWTY1aYwxwBqG`)
- Compose: `app` (id: `Vp8hf-hDlq1RdavCgBIi1`)
- URL: configured in Dokploy admin, accessible via DNS

### 6.4 Production domain

- Dashboard: `https://dca-bot.luancunha.dev`
- Public view: `/` (no login)
- Admin view: `/` after login (button top-right)
- Copy-trader tab: `/copy` (toggle in admin nav)

### 6.5 Telegram identifiers

- Channel: `-1002427024288` ("Grupo VIP do Mack")
- Topic: `4` ("Sinais VIP Mack")
- Signaler sender_id: `6492923280` (@mack_aqui)

### 6.6 Common commands

```bash
# Repo root
cd /Users/anlu/www/personal/bybit-dca-bot

# Build everything
pnpm install
pnpm build
pnpm typecheck
pnpm --filter @dca/copy-trader test

# Dev (local)
pnpm dev                                  # turbo runs both bot + web + copy-trader

# Telegram session generator (interactive, requires phone + code)
cd apps/copy-trader
TELEGRAM_API_ID=<id> TELEGRAM_API_HASH=<hash> pnpm auth

# SSH
ssh hostinger-vps

# Tail copy-trader logs
ssh hostinger-vps 'docker logs --tail=50 dcacryptobot-app-oiiyui-copy-trader-1'

# Check DB
ssh hostinger-vps 'docker exec dcacryptobot-app-oiiyui-postgres-1 \
  psql -U dca -d dca_bot -c "SELECT status, COUNT(*) FROM copy_trader.signals GROUP BY status"'

# Trigger Dokploy redeploy via MCP
# (use the dokploy-deploy skill — needs DOKPLOY_API_KEY in env)
```

### 6.7 Auto-deploy

Dokploy has `autoDeploy: true` + `triggerType: push` on the compose.
Every `git push origin main` fires a build + redeploy. Watch via
`ls -t /etc/dokploy/logs/dcacryptobot-app-oiiyui/*.log | head -1 | xargs cat`.

---

## 7. Currently in-flight (you were iterating when this was written)

You added i18n to copy-trader dashboard components:
- `apps/web/src/components/copy/SignalsTable.tsx` — uses `useTranslation`,
  refers to keys under `copy.signals.columns.*` and `copy.signals.status.*`.
- `apps/web/src/components/copy/ConfigForm.tsx` — same, keys under
  `copy.config.labels.*`.
- New shared components: `apps/web/src/components/copy/Pagination.tsx`,
  `StatusFilter.tsx`.
- New util: `apps/web/src/lib/format.ts` (`formatDateTime`).

These haven't been committed yet (or maybe just committed locally?).
Verify the i18n keys exist in `apps/web/src/locales/{en,pt}.json`
before pushing or the dashboard will render raw key names.

---

## 8. Open questions to resolve before F2

1. **Position sizing edge case:** when balance grows past the
   `MAX_OPEN_POSITIONS` × `risk%` allocation, do we want to scale
   positions up or keep them fixed? Currently fixed (each trade is
   `risk_pct × current_balance`, so they grow together).

2. **Cooldown after loss interaction with concurrent trades:** if
   trade A closes at a loss while trade B is still open, the cooldown
   kicks in immediately. Trade B's close after the cooldown expires
   is unaffected. Is that the intended behavior?

3. **Liquidation handling:** `inferCloseInfo` detects liquidation via
   `execType.includes("liquidation")`. Bybit's exact `execType`
   string for forced closes isn't well-documented — verify against a
   testnet liquidation before F2.

4. **What happens if Mack edits a signal message after posting?** Currently
   `signal_hash` is sha256(rawText), so editing creates a new hash =
   new row. Old row sticks as `EXECUTED` even though the signal
   changed. Consider whether to track edits via `telegram_msg_id`
   instead, with `signal_hash` as a content-fingerprint for dedup.

---

## 9. Useful previous artifacts

- F0 spec: `docs/superpowers/specs/2026-05-18-copy-trader-design.md`
- F0 plan: `docs/superpowers/plans/2026-05-18-copy-trader-f0-listener.md`
- F1 plan: `docs/superpowers/plans/2026-05-18-copy-trader-f1-dry-run.md`
- F1 deploy runbook: `DEPLOY_F1.md`
- Project conventions: `CLAUDE.md`
- Architecture overview: `ARCHITECTURE.md`
- DCA bot requirements: `REQUIREMENTS.md`
