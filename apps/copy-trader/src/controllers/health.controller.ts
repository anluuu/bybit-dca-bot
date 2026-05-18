import type { FastifyReply } from "fastify";
import { sql as pg } from "../db/client.js";
import { logger } from "../logger.js";

export async function getLive(): Promise<{ ok: true }> {
  return { ok: true };
}

export async function getReady(
  _req: unknown,
  reply: FastifyReply
): Promise<{ ok: boolean; error?: string }> {
  try {
    await pg`SELECT 1`;
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error("Readiness probe failed", { error });
    reply.code(503);
    return { ok: false, error };
  }
}
