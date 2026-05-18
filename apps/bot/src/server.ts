import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyCsrf from "@fastify/csrf-protection";
import type { Redis } from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { registerRoutes } from "./routes/index.js";

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

  // --- Routes ---

  registerRoutes(app, redisConnection);

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info("Fastify server started", { port: config.PORT });

  return app;
}
