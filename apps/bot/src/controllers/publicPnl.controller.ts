import { z } from "zod/v4";
import type { FastifyRequest, FastifyReply } from "fastify";
import { getPnl } from "../services/pnl.service.js";
import { getFirstAsset } from "../services/assets.service.js";

const querySchema = z.object({
  pair: z.string().min(1).max(20).optional(),
});

export async function getPnlHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.status(400).send({ error: "Invalid query params" });
    return;
  }

  const firstAsset = await getFirstAsset();
  if (!firstAsset) {
    reply.status(404).send({ error: "No asset configured" });
    return;
  }

  const pair = parsed.data.pair ?? firstAsset.pair;
  const result = await getPnl(pair);
  reply.send(result);
}
