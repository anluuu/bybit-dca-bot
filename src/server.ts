import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import { compare, hash } from "bcryptjs";
import type { Redis } from "ioredis";
import { sql } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/client.js";
import { sql as pgClient } from "./db/client.js";
import { assets, orders } from "./db/schema.js";
import { logger } from "./logger.js";

const startTime = Date.now();

export async function startServer(redisConnection: Redis) {
  const app = Fastify({ logger: false });

  // --- Plugins ---

  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  await app.register(fastifyCookie);

  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    cookie: {
      cookieName: "token",
      signed: false,
    },
  });

  await app.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
  });

  // --- Auth helpers ---

  const passwordHash = await hash(config.ADMIN_PASSWORD, 12);

  app.decorate(
    "authenticate",
    async function (request: any, reply: any) {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    }
  );

  const authPreHandler = { preHandler: [(app as any).authenticate] };

  // --- Auth endpoints ---

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { username, password } = request.body as {
        username: string;
        password: string;
      };

      if (!username || !password) {
        return reply.status(400).send({ error: "Missing credentials" });
      }

      if (
        username !== config.ADMIN_USERNAME ||
        !(await compare(password, passwordHash))
      ) {
        logger.warn("Failed login attempt", { username });
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      const token = app.jwt.sign(
        { sub: username, role: "admin" },
        { expiresIn: "7d" }
      );

      reply
        .setCookie("token", token, {
          path: "/",
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 7 * 24 * 60 * 60,
        })
        .send({ ok: true, username });
    }
  );

  app.post("/api/auth/logout", async (_request, reply) => {
    reply
      .clearCookie("token", { path: "/" })
      .send({ ok: true });
  });

  app.get("/api/auth/me", async (request, reply) => {
    try {
      await request.jwtVerify();
      const payload = request.user as { sub: string; role: string };
      return { username: payload.sub, role: payload.role };
    } catch {
      return reply.status(401).send({ error: "Not authenticated" });
    }
  });

  // --- Health endpoints (public) ---

  app.get("/health", async () => {
    return {
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  });

  app.get("/health/ready", async (_req, reply) => {
    let pgOk = false;
    let redisOk = false;

    try {
      await pgClient`SELECT 1`;
      pgOk = true;
    } catch {
      // postgres down
    }

    try {
      const pong = await redisConnection.ping();
      redisOk = pong === "PONG";
    } catch {
      // redis down
    }

    const healthy = pgOk && redisOk;

    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      postgres: pgOk ? "connected" : "disconnected",
      redis: redisOk ? "connected" : "disconnected",
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  // --- Public API (read-only, limited data) ---

  app.get("/api/public/summary", async () => {
    const now = new Date();
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );
    const startOfNextMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );

    const allFilled = await db
      .select({
        totalOrders: sql<string>`COUNT(*)`,
        totalBtc: sql<string>`COALESCE(SUM(${orders.quantity}), 0)`,
        totalSpent: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
        avgPrice: sql<string>`COALESCE(AVG(${orders.price}), 0)`,
      })
      .from(orders)
      .where(sql`${orders.status} = 'filled'`);

    const monthly = await db
      .select({
        monthlySpent: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
      })
      .from(orders)
      .where(
        sql`${orders.status} = 'filled'
          AND ${orders.executedAt} >= ${startOfMonth.toISOString()}
          AND ${orders.executedAt} < ${startOfNextMonth.toISOString()}`
      );

    const firstAsset = await db.select().from(assets).limit(1);

    return {
      totalOrders: parseInt(allFilled[0].totalOrders),
      totalBtc: parseFloat(allFilled[0].totalBtc),
      totalSpent: parseFloat(allFilled[0].totalSpent),
      avgPrice: parseFloat(allFilled[0].avgPrice),
      monthlySpent: parseFloat(monthly[0].monthlySpent),
      monthlyCap: firstAsset[0] ? parseFloat(firstAsset[0].monthlyCap) : 1000,
    };
  });

  app.get("/api/public/chart", async () => {
    const filled = await db
      .select({
        executedAt: orders.executedAt,
        quantity: orders.quantity,
        fiatSpent: orders.fiatSpent,
      })
      .from(orders)
      .where(sql`${orders.status} = 'filled'`)
      .orderBy(orders.executedAt);

    let cumulativeBtc = 0;
    let cumulativeSpent = 0;

    return filled.map((o) => {
      cumulativeBtc += parseFloat(o.quantity!);
      cumulativeSpent += parseFloat(o.fiatSpent!);
      return {
        date: o.executedAt.toISOString(),
        btc: parseFloat(cumulativeBtc.toFixed(8)),
        spent: parseFloat(cumulativeSpent.toFixed(2)),
      };
    });
  });

  // --- Private API (auth required) ---

  app.get("/api/orders", authPreHandler, async () => {
    return db
      .select()
      .from(orders)
      .orderBy(desc(orders.executedAt))
      .limit(100);
  });

  app.get("/api/orders/summary", authPreHandler, async () => {

    const now = new Date();
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );
    const startOfNextMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );

    const allFilled = await db
      .select({
        totalOrders: sql<string>`COUNT(*)`,
        totalBtc: sql<string>`COALESCE(SUM(${orders.quantity}), 0)`,
        totalSpent: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
        avgPrice: sql<string>`COALESCE(AVG(${orders.price}), 0)`,
      })
      .from(orders)
      .where(sql`${orders.status} = 'filled'`);

    const monthly = await db
      .select({
        monthlySpent: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
      })
      .from(orders)
      .where(
        sql`${orders.status} = 'filled'
          AND ${orders.executedAt} >= ${startOfMonth.toISOString()}
          AND ${orders.executedAt} < ${startOfNextMonth.toISOString()}`
      );

    const firstAsset = await db.select().from(assets).limit(1);

    return {
      totalOrders: parseInt(allFilled[0].totalOrders),
      totalBtc: parseFloat(allFilled[0].totalBtc),
      totalSpent: parseFloat(allFilled[0].totalSpent),
      avgPrice: parseFloat(allFilled[0].avgPrice),
      monthlySpent: parseFloat(monthly[0].monthlySpent),
      monthlyCap: firstAsset[0] ? parseFloat(firstAsset[0].monthlyCap) : 1000,
    };
  });

  app.get("/api/assets", authPreHandler, async () => {
    return db.select().from(assets);
  });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info("Fastify server started", { port: config.PORT });

  return app;
}
