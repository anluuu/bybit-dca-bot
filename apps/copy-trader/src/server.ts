import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { desc, eq, and, sql } from "drizzle-orm";
import { db, sql as pg } from "./db/client.js";
import { signals } from "./db/schema.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

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
    async (req) => {
      const q = req.query as { page?: string; pageSize?: string; status?: string };
      const page = Math.max(1, Number(q.page ?? "1"));
      const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? "50")));
      const offset = (page - 1) * pageSize;

      const whereStatus = q.status ? eq(signals.status, q.status) : undefined;

      const rows = await db
        .select()
        .from(signals)
        .where(whereStatus ?? sql`true`)
        .orderBy(desc(signals.receivedAt))
        .limit(pageSize)
        .offset(offset);

      const total = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(signals)
        .where(whereStatus ?? sql`true`);

      return {
        page,
        pageSize,
        total: total[0]?.count ?? 0,
        items: rows.map((r) => ({
          id: r.id,
          signalHash: r.signalHash,
          rawText: r.rawText,
          telegramMsgId: Number(r.telegramMsgId),
          receivedAt: r.receivedAt.toISOString(),
          direction: r.direction,
          symbol: r.symbol,
          entryLow: r.entryLow,
          entryHigh: r.entryHigh,
          stopLoss: r.stopLoss,
          leverageRaw: r.leverageRaw,
          takeProfit1: r.takeProfit1,
          takeProfit2: r.takeProfit2,
          takeProfit3: r.takeProfit3,
          status: r.status,
          skipReason: r.skipReason,
        })),
      };
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
