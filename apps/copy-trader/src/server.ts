import Fastify from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { registerRoutes } from "./routes/index.js";

export async function buildServer() {
  const app = Fastify({ logger: false, trustProxy: true });

  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    cookie: { cookieName: "token", signed: false },
  });

  registerRoutes(app);

  return app;
}

export async function startServer() {
  const app = await buildServer();
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info("HTTP server listening", { port: config.PORT });
  return app;
}
