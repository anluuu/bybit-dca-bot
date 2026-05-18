import { z } from "zod/v4";
import type { FastifyRequest, FastifyReply } from "fastify";
import { findAssetByPair } from "../services/assets.service.js";
import {
  findBusyReason,
  buildTestPreview,
} from "../services/testOrder.service.js";
import { executeTestOrder } from "../domain/strategy.js";
import { ExchangeClientError } from "../infra/exchange.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const testBodySchema = z.object({
  pair: z.string().min(1).max(20),
});

export async function preview(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = testBodySchema.safeParse(request.body);
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

  const result = await buildTestPreview(asset);
  if (!result.ok) {
    reply.status(result.status).send({ error: result.error });
    return;
  }

  reply.send(result.preview);
}

export async function execute(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = testBodySchema.safeParse(request.body);
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

  const busyReason = await findBusyReason(pair);
  if (busyReason) {
    reply.status(409).send({ error: busyReason });
    return;
  }

  logger.info("Admin triggered test order", {
    pair,
    amountBrl: config.TEST_ORDER_AMOUNT_BRL,
  });

  try {
    const row = await executeTestOrder(asset, config.TEST_ORDER_AMOUNT_BRL);
    reply.send({
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
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Test order failed", { pair, error: msg });
    if (error instanceof ExchangeClientError) {
      reply.status(400).send({ error: msg });
      return;
    }
    reply.status(500).send({ error: msg });
  }
}
