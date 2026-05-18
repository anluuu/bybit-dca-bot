import type { FastifyRequest, FastifyReply } from "fastify";
import { getFirstAsset } from "../services/assets.service.js";
import { getPublicSignals } from "../services/signals.service.js";

export async function getSignals(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const firstAsset = await getFirstAsset();
  if (!firstAsset) {
    reply.status(404).send({ error: "No asset configured" });
    return;
  }
  const payload = await getPublicSignals(firstAsset);
  reply.send(payload);
}
