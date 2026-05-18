import type { FastifyRequest, FastifyReply } from "fastify";
import { getPublicStatus } from "../services/assets.service.js";

export async function getStatus(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const status = await getPublicStatus();
  if (!status) {
    reply.status(404).send({ error: "No asset configured" });
    return;
  }
  reply.send(status);
}
