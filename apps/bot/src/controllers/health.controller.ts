import type { FastifyRequest, FastifyReply } from "fastify";
import type { Redis } from "ioredis";
import { sql as pgClient } from "../db/client.js";

const startTime = Date.now();

export async function getStatus(): Promise<{ status: string; uptime: number }> {
  return {
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };
}

/**
 * Factory: returns the /health/ready handler closed over the Redis connection.
 * Redis is only needed for the readiness check, so we inject it here rather
 * than making it a module-level singleton.
 */
export function createReadyHandler(redisConnection: Redis) {
  return async function getReady(
    _req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
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

    reply.status(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      postgres: pgOk ? "connected" : "disconnected",
      redis: redisOk ? "connected" : "disconnected",
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  };
}
