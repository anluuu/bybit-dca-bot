import type { FastifyRequest, FastifyReply } from "fastify";
import type { CopyConfig } from "@dca/shared";
import { getAllConfig, setConfig } from "../infra/configStore.js";

export async function getConfig(): Promise<CopyConfig> {
  return await getAllConfig();
}

export async function putConfig(
  req: FastifyRequest<{ Params: { key: string }; Body: { value: string } }>,
  reply: FastifyReply
): Promise<{ ok: true } | { error: string }> {
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
