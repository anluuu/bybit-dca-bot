# Bybit Bitcoin DCA Bot — Requirements Specification

## 1. Project Overview

**Goal:** An automated bot that buys a fixed BRL amount of Bitcoin every Sunday on Bybit exchange using a "gentle discount with market fallback" limit order strategy, running as a Docker container on a Dokploy-managed VPS.

**Language:** TypeScript (Node.js runtime)

---

## 2. Functional Requirements

### FR-1: Scheduled Weekly Purchase
- Execute a buy every **Sunday at 08:00 UTC**
- Buy **~250 BRL** worth of BTC using the **BTC/BRL** spot pair
- Configurable via environment variables

### FR-2: Order Strategy — Gentle Discount with Market Fallback
1. Fetch current BTC/BRL market price
2. Place a **limit buy order at 0.3% below market price**
3. Poll order status for up to **2 hours**
4. If not filled after 2 hours → **cancel limit order** and place a **market order**
5. The DCA must never miss a week

### FR-3: Retry Logic
- On API error or transient failure: **retry up to 3 times**
- Wait **5 minutes** between retries
- After 3 failures → abort and notify via Telegram

### FR-4: Monthly Spending Cap
- Track total BRL spent in the current calendar month
- If next purchase would exceed **1000 BRL/month** → skip and notify
- Reset counter on the 1st of each month

### FR-5: Purchase History
- Store every executed order in a **PostgreSQL** database
- Record: date, pair, order type (limit/market), price, BTC amount, BRL spent, fees, order ID, status

### FR-6: Telegram Notifications
Send a Telegram message on:
- Buy executed successfully (include: price, BTC amount, BRL spent, fees)
- Buy failed after all retries (include: error details)
- Monthly cap reached (include: total spent this month)
- Limit order expired → falling back to market order

### FR-7: Configuration via Environment Variables

| Variable | Example | Description |
|---|---|---|
| `BYBIT_API_KEY` | `xxx` | API key (sub-account) |
| `BYBIT_API_SECRET` | `xxx` | API secret (sub-account) |
| `TELEGRAM_BOT_TOKEN` | `xxx` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | `123456` | Target chat/group ID |
| `BUY_AMOUNT_BRL` | `250` | Amount per purchase |
| `MONTHLY_CAP_BRL` | `1000` | Monthly spending limit |
| `CRON_SCHEDULE` | `0 8 * * 0` | Cron expression (Sunday 08:00 UTC) |
| `LIMIT_DISCOUNT_PCT` | `0.3` | Limit order discount % |
| `LIMIT_WAIT_MINUTES` | `120` | How long to wait for limit fill |
| `TRADING_PAIR` | `BTCBRL` | Spot trading pair |
| `DATABASE_URL` | `postgres://...` | PostgreSQL connection string |

---

## 3. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Deployment** | Docker container on Dokploy |
| **Reliability** | Must survive VPS restarts (container auto-restart policy) |
| **Security** | Bybit sub-account with spot-trading-only permissions. API keys only via env vars, never in code or logs |
| **Logging** | Structured logs (timestamp, level, message) to stdout |
| **Extensibility** | Design for multi-coin support later (pair + amount per asset) |
| **Future UI** | React + TanStack (Router/Query) dashboard reading from PostgreSQL |

---

## 4. User Stories

| # | Story | Acceptance Criteria |
|---|---|---|
| US-1 | As a user, I want the bot to buy BTC every Sunday automatically | Order executes at 08:00 UTC every Sunday without manual intervention |
| US-2 | As a user, I want limit orders with market fallback | Limit order placed first; market order used if limit doesn't fill in 2h |
| US-3 | As a user, I want Telegram alerts for all events | Receive messages for success, failure, cap reached, and fallback |
| US-4 | As a user, I want a monthly spending cap | Bot skips purchase and notifies when 1000 BRL/month would be exceeded |
| US-5 | As a user, I want purchase history stored | All orders recorded in PostgreSQL with full details |
| US-6 | As a user, I want the bot to recover from errors | Retries 3 times with 5-min gaps before giving up |
| US-7 | As a user, I want to configure everything via env vars | All parameters adjustable without code changes |

---

## 5. Tech Stack

| Layer | Choice |
|---|---|
| Language | TypeScript |
| Runtime | Node.js |
| Package Manager | pnpm |
| HTTP Framework | Fastify (health checks + future API) |
| HTTP Client | Axios |
| Job Queue | BullMQ (Redis-backed) |
| Exchange API | Bybit V5 REST API |
| Database | PostgreSQL |
| ORM | Drizzle |
| Cache/Queue Backend | Redis |
| Notifications | Telegraf (telegraf.js.org) |
| Container | Docker + docker-compose |
| Deployment | Dokploy on VPS |
| Future UI | React + TanStack (Router/Query) |

---

## 6. Resolved Decisions

- **Sub-account**: User will create a dedicated Bybit sub-account for the bot
- **Auto-withdrawal**: Not in scope
- **UI framework**: React + TanStack (Router, Query) — to be built later
- **Order strategy**: Limit at -0.3% market → 2h wait → market fallback
- **Database**: PostgreSQL over SQLite for Dokploy compatibility and future UI

---

## 7. Next Steps

1. `/sc:design` — Architecture, database schema, project structure
2. `/sc:workflow` — Implementation plan with ordered tasks
3. `/sc:implement` — Build it
