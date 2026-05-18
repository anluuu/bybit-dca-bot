import { Queue, Worker, UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { db } from "./db/client.js";
import { assets, orders } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { executeDca } from "./domain/strategy.js";
import { notifyFailure } from "./infra/notifications.js";
import { logger } from "./logger.js";

const QUEUE_NAME = "dca-jobs";

interface DcaJobData {
  assetId: number;
}

export function createRedisConnection(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function setupQueue(redisConnection: Redis) {
  const queue = new Queue<DcaJobData>(QUEUE_NAME, {
    connection: redisConnection,
  });

  const worker = new Worker<DcaJobData>(
    QUEUE_NAME,
    async (job: Job<DcaJobData>) => {
      const asset = await db
        .select()
        .from(assets)
        .where(eq(assets.id, job.data.assetId))
        .then((rows) => rows[0]);

      if (!asset) {
        throw new UnrecoverableError(
          `Asset not found: ${job.data.assetId}`
        );
      }

      if (!asset.enabled) {
        logger.info("Asset disabled, skipping", { pair: asset.pair });
        return;
      }

      await executeDca(asset);
    },
    {
      connection: redisConnection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    logger.info("DCA job completed", {
      jobId: job.id,
      name: job.name,
    });
  });

  worker.on("failed", async (job, error) => {
    if (!job) return;

    logger.error("DCA job failed", {
      jobId: job.id,
      name: job.name,
      attempts: job.attemptsMade,
      error: error.message,
    });

    // Only notify on final failure (all retries exhausted)
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      const asset = await db
        .select()
        .from(assets)
        .where(eq(assets.id, job.data.assetId))
        .then((rows) => rows[0]);

      if (asset) {
        await db.insert(orders).values({
          assetId: asset.id,
          pair: asset.pair,
          orderType: "limit",
          status: "failed",
          errorMessage: error.message,
        });

        await notifyFailure(
          `${error.message} (after ${job.attemptsMade} attempts)`,
          asset.pair
        );
      }
    }
  });

  return { queue, worker };
}

export async function registerJobs(queue: Queue<DcaJobData>) {
  const enabledAssets = await db
    .select()
    .from(assets)
    .where(eq(assets.enabled, true));

  for (const asset of enabledAssets) {
    const jobName = `dca-${asset.pair}`;

    // Remove existing repeatable jobs for this asset to avoid duplicates
    const existingJobs = await queue.getRepeatableJobs();
    for (const existing of existingJobs) {
      if (existing.name === jobName) {
        await queue.removeRepeatableByKey(existing.key);
      }
    }

    await queue.add(
      jobName,
      { assetId: asset.id },
      {
        repeat: {
          pattern: asset.cronSchedule,
          tz: "UTC",
        },
        attempts: 3,
        backoff: {
          type: "fixed",
          delay: 300_000,
        },
      }
    );

    logger.info("Registered DCA job", {
      pair: asset.pair,
      schedule: asset.cronSchedule,
    });
  }
}
