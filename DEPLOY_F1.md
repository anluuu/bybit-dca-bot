# Copy-Trader F1 — Deployment Runbook

## Prerequisites (do these BEFORE flipping DRY_RUN=false)

1. **Create a Bybit sub-account** in your existing Bybit org.
   - Bybit web → Settings → Sub-Accounts → Create
   - Type: **Unified Trading**
   - Name it something obvious (e.g. `copy-trader-mack`)

2. **Generate an API key under the sub-account** with:
   - Permissions: **Derivatives → Read & Trade** ONLY
   - **Disable** Withdrawal and Spot trading
   - IP restriction: optional but recommended (use the Dokploy VPS IP `69.62.100.241`)
   - Save the key/secret somewhere safe.

3. **Fund the sub-account** with ~50 USDT (Bybit web → Transfer → Funding → sub-account).

4. **Set env vars in Dokploy** (project `dca-crypto-bot` → service `app` → Environment):
   - `COPY_BYBIT_API_KEY=<your key>`
   - `COPY_BYBIT_API_SECRET=<your secret>`
   - `COPY_BYBIT_TESTNET=false`
   - `COPY_INITIAL_CAPITAL_USDT_OVERRIDE=` (leave empty — the bot reads the actual balance on first boot)

5. Trigger a redeploy in Dokploy. Watch the logs (`docker logs copy-trader …`) for `Bybit client initialized` and `system_state.initial_capital populated`.

## First-trade walkthrough (still DRY_RUN)

When Mack posts a signal in topic 4:

- Listener parses → inserts `signals` row.
- Executor calls riskGate → if pass, computes plan → inserts `trades` row with `status=DRY_RUN_LOGGED, dry_run=true`.
- Telegram notify fires with the parsed signal summary.
- Dashboard → Copy Trader tab → **Trades** section shows the dry-run row with `DRY` tag.

Inspect the row: `plannedQty`, `plannedMargin`, `leverageUsed`, `tpPrice`, `slPrice`. Sanity-check by hand:

- Risk USDT = balance × MAX_RISK_PCT
- SL distance % = |entry − SL| / entry
- Position USDT = risk / SL distance %
- Qty = position USDT / entry, floored to qtyStep
- Margin = position USDT / leverage_used

These should match the row.

## Going live (F2 territory — separate plan)

Don't flip DRY_RUN here. F2 is a separate plan that adds:
- Kill-switch arming verification
- Initial-capital lock-in confirmation
- First-live-trade observability checks
- Rollback procedure

## Troubleshooting

| Symptom | First check |
|---------|-------------|
| Watcher silent | `docker logs copy-trader` for `Watcher job failed` |
| `Bybit API key/secret not configured` | Env vars not set in Dokploy |
| `Bybit 110007: …` | Insufficient balance — fund the sub-account |
| `Bybit 110045: …` | Cannot set leverage — symbol may be in margin-mode mismatch |
| Trade stuck in `PENDING_FILL` | Order may have cancelled silently — check Bybit UI |
| Trade stuck in `OPEN` after Bybit position closed | Watcher's `inferCloseInfo` heuristic missed — check `copy_trader.trades.exit_price` vs `tp_price`/`sl_price` |
