import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { desc, eq, sql, and, inArray } from "drizzle-orm";
import type { CopySignalsPage } from "@dca/shared";
import { db, sql as pg } from "./db/client.js";
import { signals, trades, dailyStats, systemState } from "./db/schema.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getAllConfig, setConfig } from "./configStore.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { username: string };
    user: { username: string };
  }
}

async function authPreHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: "Unauthorized" });
  }
}

export async function buildServer() {
  const app = Fastify({ logger: false, trustProxy: true });

  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    cookie: { cookieName: "token", signed: false },
  });

  // ---- Health ----

  app.get("/health/live", async () => ({ ok: true }));

  app.get("/health/ready", async (_req, reply) => {
    try {
      await pg`SELECT 1`;
      return { ok: true };
    } catch {
      reply.code(503);
      return { ok: false };
    }
  });

  // ---- Public-by-virtue-of-listing-only? No — F0 has admin-only endpoints. ----

  app.get(
    "/api/copy/signals",
    { preHandler: authPreHandler },
    async (req): Promise<CopySignalsPage> => {
      const q = req.query as { page?: string; pageSize?: string; status?: string };
      const page = Math.max(1, Number(q.page ?? "1"));
      const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? "50")));
      const offset = (page - 1) * pageSize;

      const whereStatus = q.status ? eq(signals.status, q.status) : undefined;

      const rows = await db
        .select()
        .from(signals)
        .where(whereStatus)
        .orderBy(desc(signals.receivedAt))
        .limit(pageSize)
        .offset(offset);

      const total = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(signals)
        .where(whereStatus);

      return {
        page,
        pageSize,
        total: total[0]?.count ?? 0,
        items: rows.map((r) => ({
          id: r.id,
          signalHash: r.signalHash,
          rawText: r.rawText,
          telegramMsgId: Number(r.telegramMsgId),
          telegramSenderId: r.telegramSenderId == null ? null : Number(r.telegramSenderId),
          receivedAt: r.receivedAt.toISOString(),
          direction: r.direction as "LONG" | "SHORT" | null,
          symbol: r.symbol,
          entryLow: r.entryLow,
          entryHigh: r.entryHigh,
          stopLoss: r.stopLoss,
          leverageRaw: r.leverageRaw,
          takeProfit1: r.takeProfit1,
          takeProfit2: r.takeProfit2,
          takeProfit3: r.takeProfit3,
          status: r.status as CopySignalsPage["items"][number]["status"],
          skipReason: r.skipReason,
        })),
      };
    }
  );

  app.get(
    "/api/copy/trades",
    { preHandler: authPreHandler },
    async (req): Promise<import("@dca/shared").CopyTradesPage> => {
      const q = req.query as { page?: string; pageSize?: string; status?: string; includeDryRun?: string };
      const page = Math.max(1, Number(q.page ?? "1"));
      const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? "50")));
      const offset = (page - 1) * pageSize;
      const conditions: import("drizzle-orm").SQL[] = [];
      if (q.status) conditions.push(eq(trades.status, q.status));
      if (q.includeDryRun !== "true") conditions.push(eq(trades.dryRun, false));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select()
        .from(trades)
        .where(where)
        .orderBy(desc(trades.createdAt))
        .limit(pageSize)
        .offset(offset);
      const total = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(trades)
        .where(where);

      return {
        page,
        pageSize,
        total: total[0]?.count ?? 0,
        items: rows.map((r) => ({
          id: r.id,
          signalId: r.signalId,
          symbol: r.symbol,
          direction: r.direction as "LONG" | "SHORT",
          bybitOrderId: r.bybitOrderId,
          bybitOrderLinkId: r.bybitOrderLinkId,
          plannedQty: r.plannedQty,
          plannedMargin: r.plannedMargin,
          leverageUsed: r.leverageUsed,
          entryStrategy: r.entryStrategy as "MARKET" | "LIMIT_CHASE",
          limitPrice: r.limitPrice,
          limitExpiresAt: r.limitExpiresAt?.toISOString() ?? null,
          filledQty: r.filledQty,
          avgEntry: r.avgEntry,
          fillTs: r.fillTs?.toISOString() ?? null,
          tpPrice: r.tpPrice,
          slPrice: r.slPrice,
          status: r.status as import("@dca/shared").CopyTradeStatus,
          closeReason: r.closeReason,
          exitPrice: r.exitPrice,
          closeTs: r.closeTs?.toISOString() ?? null,
          pnlUsdt: r.pnlUsdt,
          feesUsdt: r.feesUsdt,
          errorMessage: r.errorMessage,
          dryRun: r.dryRun,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    }
  );

  app.get("/api/copy/stats", { preHandler: authPreHandler }, async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const [todayRows, last7, allTime, wins, losses] = await Promise.all([
      db.select().from(dailyStats).where(eq(dailyStats.day, todayStr)).limit(1),
      db
        .select({
          pnl: sql<number>`COALESCE(SUM(${dailyStats.pnlUsdt}::numeric), 0)::float`,
          closed: sql<number>`COALESCE(SUM(${dailyStats.tradesClosed}), 0)::int`,
        })
        .from(dailyStats)
        .where(sql`${dailyStats.day} > current_date - INTERVAL '7 days'`),
      db
        .select({
          pnl: sql<number>`COALESCE(SUM(${dailyStats.pnlUsdt}::numeric), 0)::float`,
          closed: sql<number>`COALESCE(SUM(${dailyStats.tradesClosed}), 0)::int`,
        })
        .from(dailyStats),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(trades)
        .where(and(eq(trades.dryRun, false), inArray(trades.status, ["CLOSED_TP"]))),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(trades)
        .where(and(eq(trades.dryRun, false), inArray(trades.status, ["CLOSED_SL", "LIQUIDATED"]))),
    ]);

    return {
      today: {
        pnlUsdt: Number(todayRows[0]?.pnlUsdt ?? 0),
        tradesClosed: todayRows[0]?.tradesClosed ?? 0,
      },
      last7: { pnlUsdt: last7[0]?.pnl ?? 0, tradesClosed: last7[0]?.closed ?? 0 },
      allTime: { pnlUsdt: allTime[0]?.pnl ?? 0, tradesClosed: allTime[0]?.closed ?? 0 },
      wins: wins[0]?.c ?? 0,
      losses: losses[0]?.c ?? 0,
    };
  });

  app.get("/api/copy/system-state", { preHandler: authPreHandler }, async () => {
    const rows = await db.select().from(systemState).where(eq(systemState.id, 1)).limit(1);
    const s = rows[0];
    return {
      killed: s?.killed ?? false,
      killedReason: s?.killedReason ?? null,
      killedAt: s?.killedAt?.toISOString() ?? null,
      cooldownUntil: s?.cooldownUntil?.toISOString() ?? null,
      cooldownReason: s?.cooldownReason ?? null,
      initialCapital: s?.initialCapital ?? null,
    };
  });

  app.get("/api/copy/config", { preHandler: authPreHandler }, async () => {
    return await getAllConfig();
  });

  app.put<{ Params: { key: string }; Body: { value: string } }>(
    "/api/copy/config/:key",
    { preHandler: authPreHandler },
    async (req, reply) => {
      const { key } = req.params;
      const value = req.body?.value;
      if (typeof value !== "string") {
        reply.code(400);
        return { error: "value must be a string" };
      }
      try {
        await setConfig(key, value);
        return { ok: true };
      } catch (e) {
        reply.code(400);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }
  );

  app.post(
    "/api/copy/admin/reset-kill-switch",
    { preHandler: authPreHandler },
    async () => {
      await db
        .update(systemState)
        .set({ killed: false, killedReason: null, killedAt: null, updatedAt: new Date() })
        .where(eq(systemState.id, 1));
      return { ok: true };
    }
  );

  app.post(
    "/api/copy/admin/kill",
    { preHandler: authPreHandler },
    async (req) => {
      const reason = (req.body as { reason?: string } | undefined)?.reason ?? "manual";
      await db
        .update(systemState)
        .set({ killed: true, killedReason: reason, killedAt: new Date(), updatedAt: new Date() })
        .where(eq(systemState.id, 1));
      return { ok: true };
    }
  );

  return app;
}

export async function startServer() {
  const app = await buildServer();
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info("HTTP server listening", { port: config.PORT });
  return app;
}
