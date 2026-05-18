import { z } from "zod/v4";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { AdminRunNowResult } from "@dca/shared";
import { findAssetByPair } from "../services/assets.service.js";
import { findBusyReason } from "../services/testOrder.service.js";
import { fireAndForgetDca } from "../services/admin.service.js";
import { notifyPing } from "../infra/notifications.js";

const runNowBodySchema = z.object({
  pair: z.string().min(1).max(20),
});

export async function runNow(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = runNowBodySchema.safeParse(request.body);
  if (!parsed.success) {
    reply.status(400).send({ error: "Invalid body" });
    return;
  }
  const { pair } = parsed.data;

  const asset = await findAssetByPair(pair);
  if (!asset) {
    reply.status(404).send({ error: `Unknown pair: ${pair}` });
    return;
  }

  if (!asset.enabled) {
    reply.status(409).send({ error: `Asset disabled: ${pair}` });
    return;
  }

  const busyReason = await findBusyReason(pair);
  if (busyReason) {
    reply.status(409).send({ error: busyReason });
    return;
  }

  const startedAt = fireAndForgetDca(asset);

  const body: AdminRunNowResult = {
    pair,
    status: "started",
    errorMessage: null,
    startedAt,
  };
  reply.status(202).send(body);
}

export async function pingTelegram(
  _request: FastifyRequest,
  _reply: FastifyReply
): Promise<{ ok: boolean; sentAt: string }> {
  await notifyPing("Manual ping from admin dashboard.");
  return { ok: true, sentAt: new Date().toISOString() };
}
