import { Queue, Worker, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

const connection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

connection.on("error", (e: Error) => logger.warn("Redis error", { error: e.message }));

const QUEUE_NAME = "copy-trader-watcher";

export const watcherQueue = new Queue(QUEUE_NAME, { connection });

export async function registerWatcherRepeatable(intervalMs = 30_000): Promise<void> {
  // Replace any existing repeatable definition so an interval change in code
  // takes effect on next boot.
  const repeatables = await watcherQueue.getRepeatableJobs();
  for (const r of repeatables) {
    await watcherQueue.removeRepeatableByKey(r.key);
  }
  await watcherQueue.add(
    "tick",
    {},
    { repeat: { every: intervalMs }, removeOnComplete: true, removeOnFail: 100 }
  );
  logger.info("Watcher repeatable registered", { intervalMs });
}

export function startWatcherWorker(processor: Processor): Worker {
  const worker = new Worker(QUEUE_NAME, processor, { connection, concurrency: 1 });
  worker.on("failed", (job, err) =>
    logger.error("Watcher job failed", { jobId: job?.id, error: err.message })
  );
  return worker;
}

export async function closeQueue(): Promise<void> {
  await watcherQueue.close();
  connection.disconnect();
}
