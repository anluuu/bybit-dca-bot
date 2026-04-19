import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyCsrf from "@fastify/csrf-protection";
import { compare, hash } from "bcryptjs";
import { z } from "zod/v4";
import type { Redis } from "ioredis";
import { sql } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/client.js";
import { sql as pgClient } from "./db/client.js";
import { assets, orders } from "./db/schema.js";
import { logger } from "./logger.js";
import { executeDca, executeTestOrder } from "./strategy.js";
import { notifyFailure, notifyPing } from "./notifications.js";
import { getTickerPrice, ExchangeClientError } from "./exchange.js";
import { getMonthlySpent } from "./spending.js";
import { getCompositeSignal } from "./signals/compose.js";
import type { AdminRunNowResult, PublicSignals } from "@dca/shared";

const startTime = Date.now();

export async function startServer(redisConnection: Redis) {
  const app = Fastify({ logger: false });

  // --- Plugins ---

  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  await app.register(fastifyCookie);

  await app.register(fastifyCsrf, {
    cookieOpts: { signed: false, httpOnly: true, sameSite: "strict" },
  });

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

  const loginSchema = z.object({
    username: z.string().min(1).max(100),
    password: z.string().min(1).max(200),
  });

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid credentials format" });
      }

      const { username, password } = parsed.data;

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

  // --- Public API (read-only, sanitized data) ---
  //
  // Public endpoints expose the full purchase history, monthly breakdown,
  // next-scheduled-buy info, and cumulative chart — but strip anything
  // escalatable: bybitOrderId (vendor-side identifier), errorMessage (can
  // leak stack/key fragments), DB primary keys, and strategy-tuning asset
  // fields (limitDiscount, limitWaitMins). Test-order execution stays
  // admin-only.

  const ordersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  });

  // Admin-only extra filters. Public listing intentionally stays unfiltered
  // so search engines / casual viewers see the same raw history every time.
  const ALLOWED_STATUSES = [
    "filled",
    "failed",
    "cancelled",
    "pending",
    "skipped_cap",
  ] as const;
  const adminOrdersQuerySchema = ordersQuerySchema.extend({
    status: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(",")
              .map((s) => s.trim())
              .filter((s): s is (typeof ALLOWED_STATUSES)[number] =>
                (ALLOWED_STATUSES as readonly string[]).includes(s)
              )
          : undefined
      ),
    includeTest: z
      .string()
      .optional()
      .transform((v) => v !== "false"),
  });

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
      .where(sql`${orders.status} = 'filled' AND ${orders.isTest} = false`);

    const monthly = await db
      .select({
        monthlySpent: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
      })
      .from(orders)
      .where(
        sql`${orders.status} = 'filled'
          AND ${orders.isTest} = false
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

  /**
   * Per-calendar-month aggregation (UTC). Returns rows newest-first with
   * volume-weighted avg price and a delta vs. the chronologically previous
   * month. Shared by the admin and public monthly endpoints.
   */
  async function getMonthlyBreakdown() {
    const rows = await db.execute<{
      month: string;
      order_count: string;
      total_btc: string;
      total_spent: string;
      avg_price: string | null;
      min_price: string | null;
      max_price: string | null;
    }>(sql`
      SELECT
        to_char(${orders.executedAt} AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
        COUNT(*)::text AS order_count,
        COALESCE(SUM(${orders.quantity}), 0)::text AS total_btc,
        COALESCE(SUM(${orders.fiatSpent}), 0)::text AS total_spent,
        (SUM(${orders.fiatSpent}) / NULLIF(SUM(${orders.quantity}), 0))::text AS avg_price,
        MIN(${orders.price})::text AS min_price,
        MAX(${orders.price})::text AS max_price
      FROM ${orders}
      WHERE ${orders.status} = 'filled'
        AND ${orders.isTest} = false
        AND ${orders.quantity} IS NOT NULL
        AND ${orders.fiatSpent} IS NOT NULL
      GROUP BY 1
      ORDER BY 1 DESC
    `);

    const monthLabelFmt = new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

    // rows are newest-first; to compute vsPrevPct we need each month's
    // predecessor (chronologically earlier), which in a newest-first array
    // is the *next* index.
    return rows.map((r, i) => {
      const [y, m] = r.month.split("-").map(Number);
      const label = monthLabelFmt.format(new Date(Date.UTC(y, m - 1, 1)));
      const avgPrice = parseFloat(r.avg_price ?? "0");
      const prev = rows[i + 1];
      const prevAvg = prev ? parseFloat(prev.avg_price ?? "0") : 0;
      const vsPrevPct =
        prev && prevAvg > 0 ? ((avgPrice - prevAvg) / prevAvg) * 100 : null;

      return {
        month: r.month,
        label,
        orderCount: parseInt(r.order_count, 10),
        totalBtc: parseFloat(r.total_btc),
        totalSpent: parseFloat(r.total_spent),
        avgPrice,
        minPrice: parseFloat(r.min_price ?? "0"),
        maxPrice: parseFloat(r.max_price ?? "0"),
        vsPrevPct,
      };
    });
  }

  app.get("/api/public/monthly", async () => {
    // Full breakdown is safe to expose publicly — orderCount / min / max
    // are derivable from the public chart and aren't escalatable.
    return getMonthlyBreakdown();
  });

  app.get("/api/public/status", async (_req, reply) => {
    const [firstAsset] = await db.select().from(assets).limit(1);
    if (!firstAsset) {
      return reply.status(404).send({ error: "No asset configured" });
    }
    return {
      pair: firstAsset.pair,
      buyAmount: firstAsset.buyAmount,
      cronSchedule: firstAsset.cronSchedule,
      monthlyCap: firstAsset.monthlyCap,
    };
  });

  app.get(
    "/api/public/orders",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = ordersQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid query params" });
      }
      const { page, pageSize } = parsed.data;

      // Select explicit columns only — never leak bybitOrderId, errorMessage,
      // or DB primary keys. Signal-related columns that ARE public-safe
      // (raw market data: Mayer value, 200W distance, F&G index) are
      // included; strategy-internal fields (compositeScore,
      // appliedMultiplier, signalFallback) stay admin-only.
      const [rows, count] = await Promise.all([
        db
          .select({
            pair: orders.pair,
            orderType: orders.orderType,
            status: orders.status,
            price: orders.price,
            quantity: orders.quantity,
            fiatSpent: orders.fiatSpent,
            fee: orders.fee,
            feeCurrency: orders.feeCurrency,
            mayerMultiple: orders.mayerMultiple,
            ma200wDistancePct: orders.ma200wDistancePct,
            fearGreedIndex: orders.fearGreedIndex,
            executedAt: orders.executedAt,
          })
          .from(orders)
          .where(sql`${orders.isTest} = false`)
          .orderBy(desc(orders.executedAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db
          .select({ total: sql<string>`COUNT(*)` })
          .from(orders)
          .where(sql`${orders.isTest} = false`),
      ]);

      const total = parseInt(count[0].total);
      return {
        data: rows.map((r) => ({
          ...r,
          executedAt: r.executedAt.toISOString(),
        })),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      };
    }
  );

  /**
   * Live signal snapshot (public — sanitized).
   *
   * Exposes raw market indicators (Mayer, 200W MA distance, Fear & Greed) and
   * the composite score, plus monthly *utilization %* only. Absolute BRL cap
   * remaining and the next-buy multiplier stay admin-only (see
   * /api/admin/signals).
   */
  app.get(
    "/api/public/signals",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (_req, reply) => {
      const [firstAsset] = await db.select().from(assets).limit(1);
      if (!firstAsset) {
        return reply.status(404).send({ error: "No asset configured" });
      }

      const signal = await getCompositeSignal(firstAsset.pair);
      const spent = await getMonthlySpent(firstAsset.pair);
      const cap = parseFloat(firstAsset.monthlyCap);
      const capUtilizationPct = cap > 0 ? (spent / cap) * 100 : null;

      const payload: PublicSignals = {
        mayerMultiple: signal.mayer ? signal.mayer.multiple : null,
        ma200wDistancePct: signal.ma200w ? signal.ma200w.distancePct : null,
        fearGreedIndex: signal.fearGreed ? signal.fearGreed.value : null,
        fearGreedClassification: signal.fearGreed
          ? signal.fearGreed.classification
          : null,
        compositeScore:
          signal.fallback === "all_down" ? null : signal.composite,
        capUtilizationPct,
        fallback: signal.fallback,
        generatedAt: signal.generatedAt,
      };
      return payload;
    }
  );

  app.get("/api/public/chart", async () => {
    const filled = await db
      .select({
        executedAt: orders.executedAt,
        quantity: orders.quantity,
        fiatSpent: orders.fiatSpent,
        mayerMultiple: orders.mayerMultiple,
        ma200wDistancePct: orders.ma200wDistancePct,
      })
      .from(orders)
      .where(sql`${orders.status} = 'filled' AND ${orders.isTest} = false`)
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
        mayer: o.mayerMultiple ? parseFloat(o.mayerMultiple) : null,
        ma200wDistancePct: o.ma200wDistancePct
          ? parseFloat(o.ma200wDistancePct)
          : null,
      };
    });
  });

  // --- Private API (auth required) ---

  app.get("/api/orders", authPreHandler, async (request, reply) => {
    const parsed = adminOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query params" });
    }
    const { page, pageSize, status, includeTest } = parsed.data;

    // Build WHERE from optional filters. Paginate AND count against the same
    // predicate so totalPages reflects the filtered view — filtering client
    // side would lie about totalPages and break pagination past the first
    // page of hidden rows.
    const conditions = [sql`1 = 1`];
    if (status && status.length > 0) {
      conditions.push(sql`${orders.status} IN ${status}`);
    }
    if (!includeTest) {
      conditions.push(sql`${orders.isTest} = false`);
    }
    const whereClause = sql.join(conditions, sql` AND `);

    const [rows, count] = await Promise.all([
      db
        .select()
        .from(orders)
        .where(whereClause)
        .orderBy(desc(orders.executedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ total: sql<string>`COUNT(*)` })
        .from(orders)
        .where(whereClause),
    ]);

    return {
      data: rows,
      page,
      pageSize,
      total: parseInt(count[0].total),
      totalPages: Math.ceil(parseInt(count[0].total) / pageSize),
    };
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
      .where(sql`${orders.status} = 'filled' AND ${orders.isTest} = false`);

    const monthly = await db
      .select({
        monthlySpent: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
      })
      .from(orders)
      .where(
        sql`${orders.status} = 'filled'
          AND ${orders.isTest} = false
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

  app.get("/api/orders/monthly", authPreHandler, async () => {
    return getMonthlyBreakdown();
  });

  app.get("/api/assets", authPreHandler, async () => {
    return db.select().from(assets);
  });

  // --- Test order endpoints (admin-only, operator sanity-check) ---
  //
  // Test orders execute a small real market buy (TEST_ORDER_AMOUNT_BRL) to
  // validate the end-to-end pipeline between weekly DCAs. They're tagged
  // is_test=true and excluded from monthly-cap accounting and dashboard
  // aggregates.

  const testBodySchema = z.object({
    pair: z.string().min(1).max(20),
  });

  /**
   * Return true if there's an in-flight (pending) order on this pair recently,
   * which would indicate a real DCA job is mid-execution. Test orders must not
   * race with the real worker.
   */
  async function findBusyReason(pair: string): Promise<string | null> {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const pending = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        sql`${orders.pair} = ${pair}
          AND ${orders.status} = 'pending'
          AND ${orders.executedAt} >= ${tenMinAgo}`
      )
      .limit(1);

    if (pending.length > 0) {
      return "Another order is already in flight for this pair. Wait for it to finish.";
    }
    return null;
  }

  app.post(
    "/api/test/preview",
    {
      ...authPreHandler,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = testBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid body" });
      }
      const { pair } = parsed.data;

      const [asset] = await db
        .select()
        .from(assets)
        .where(sql`${assets.pair} = ${pair}`)
        .limit(1);

      if (!asset) {
        return reply.status(404).send({ error: `Unknown pair: ${pair}` });
      }

      let currentPrice: number;
      try {
        currentPrice = await getTickerPrice(pair);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn("Test preview ticker fetch failed", { pair, error: msg });
        return reply.status(502).send({ error: `Ticker fetch failed: ${msg}` });
      }

      const testAmountBrl = config.TEST_ORDER_AMOUNT_BRL;
      const estimatedQty = testAmountBrl / currentPrice;
      const monthlySpent = await getMonthlySpent(pair);
      const monthlyCap = parseFloat(asset.monthlyCap);
      const busyReason = await findBusyReason(pair);

      return {
        pair,
        testAmountBrl,
        currentPrice,
        estimatedQty,
        monthlySpent,
        monthlyCap,
        busy: busyReason !== null,
        busyReason,
        generatedAt: new Date().toISOString(),
      };
    }
  );

  app.post(
    "/api/test/execute",
    {
      ...authPreHandler,
      config: { rateLimit: { max: 2, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = testBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid body" });
      }
      const { pair } = parsed.data;

      const [asset] = await db
        .select()
        .from(assets)
        .where(sql`${assets.pair} = ${pair}`)
        .limit(1);

      if (!asset) {
        return reply.status(404).send({ error: `Unknown pair: ${pair}` });
      }

      const busyReason = await findBusyReason(pair);
      if (busyReason) {
        return reply.status(409).send({ error: busyReason });
      }

      logger.info("Admin triggered test order", {
        pair,
        amountBrl: config.TEST_ORDER_AMOUNT_BRL,
      });

      try {
        const row = await executeTestOrder(asset, config.TEST_ORDER_AMOUNT_BRL);
        return {
          orderId: row.id,
          bybitOrderId: row.bybitOrderId,
          status: row.status,
          pair: row.pair,
          price: row.price,
          quantity: row.quantity,
          fiatSpent: row.fiatSpent,
          fee: row.fee,
          feeCurrency: row.feeCurrency,
          errorMessage: row.errorMessage,
          executedAt: row.executedAt.toISOString(),
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("Test order failed", { pair, error: msg });
        if (error instanceof ExchangeClientError) {
          return reply.status(400).send({ error: msg });
        }
        return reply.status(500).send({ error: msg });
      }
    }
  );

  // --- Admin run-now (one-shot real DCA, counts toward cap) ---
  //
  // Intended for catching up a missed weekly cron (e.g. 2026-04-19 failure).
  // Unlike /api/test/execute this runs the full strategy — limit + market
  // fallback + monthly-cap check — and persists real (is_test=false) rows.
  // executeDca polls for up to limitWaitMins, so we fire-and-forget and
  // reply 202. Rate-limited 1/min to prevent accidental double-fires.

  const runNowBodySchema = z.object({
    pair: z.string().min(1).max(20),
  });

  app.post(
    "/api/admin/run-now",
    {
      ...authPreHandler,
      config: { rateLimit: { max: 1, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = runNowBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid body" });
      }
      const { pair } = parsed.data;

      const [asset] = await db
        .select()
        .from(assets)
        .where(sql`${assets.pair} = ${pair}`)
        .limit(1);

      if (!asset) {
        return reply.status(404).send({ error: `Unknown pair: ${pair}` });
      }

      if (!asset.enabled) {
        return reply.status(409).send({ error: `Asset disabled: ${pair}` });
      }

      const busyReason = await findBusyReason(pair);
      if (busyReason) {
        return reply.status(409).send({ error: busyReason });
      }

      const startedAt = new Date().toISOString();
      logger.info("Admin triggered run-now DCA", { pair, startedAt });

      // Fire-and-forget: executeDca polls the limit order for minutes, so
      // we can't hold the HTTP connection. Errors are already surfaced via
      // Telegram + DB rows inside the strategy/queue flow.
      void executeDca(asset).catch(async (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("run-now DCA failed", { pair, error: msg });
        // Parity with worker.on("failed"): persist a failed row so the
        // dashboard shows the attempt, then fire a Telegram alert. Only the
        // worker path gates on attemptsMade; run-now has no retry, so we
        // persist unconditionally.
        try {
          await db.insert(orders).values({
            assetId: asset.id,
            pair: asset.pair,
            orderType: "limit",
            status: "failed",
            errorMessage: msg,
          });
          await notifyFailure(`${msg} (admin run-now)`, asset.pair);
        } catch (inner) {
          logger.error("run-now failure recording also failed", {
            pair,
            error: inner instanceof Error ? inner.message : String(inner),
          });
        }
      });

      const body: AdminRunNowResult = {
        pair,
        status: "started",
        errorMessage: null,
        startedAt,
      };
      return reply.status(202).send(body);
    }
  );

  // --- Admin Telegram diagnostic ---
  //
  // Send a test message to TELEGRAM_CHAT_ID. If this returns 200 but no
  // Telegram message arrives, check bot logs for "Telegram notification
  // failed" (bad chat id, revoked token, network block). Rate-limited 5/min.

  app.post(
    "/api/admin/telegram/ping",
    {
      ...authPreHandler,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (_request, _reply) => {
      await notifyPing("Manual ping from admin dashboard.");
      return { ok: true, sentAt: new Date().toISOString() };
    }
  );

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info("Fastify server started", { port: config.PORT });

  return app;
}
