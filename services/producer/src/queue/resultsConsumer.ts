import { createClient } from "redis";
import { upsertAuditResult, type CompletedJob } from "../repositories/audits.js";
import { errorMessage } from "../errorMessage.js";

const RESULTS_QUEUE_KEY = "fila:resultados";
const RESULTS_PROCESSING_KEY = "fila:resultados:processando";
const BLOCK_SECONDS = 5;

function isCompletedJob(value: unknown): value is CompletedJob {
  return typeof value === "object" && value !== null && "result" in value;
}

async function recoverAbandonedJobs(client: ReturnType<typeof createClient>): Promise<void> {
  let moved = 0;
  while (await client.lMove(RESULTS_PROCESSING_KEY, RESULTS_QUEUE_KEY, "RIGHT", "LEFT")) moved++;
  if (moved > 0) console.log(`[ResultsConsumer] Requeued ${moved} job(s) left over from a previous run.`);
}

async function consumeOne(client: ReturnType<typeof createClient>): Promise<void> {
  const popped = await client.blMove(RESULTS_QUEUE_KEY, RESULTS_PROCESSING_KEY, "RIGHT", "LEFT", BLOCK_SECONDS);
  if (!popped) return;

  let job: unknown;
  try {
    job = JSON.parse(popped);
  } catch (error) {
    console.error("[ResultsConsumer] Dropping malformed message:", errorMessage(error));
    await client.lRem(RESULTS_PROCESSING_KEY, 1, popped);
    return;
  }

  if (!isCompletedJob(job)) {
    console.error("[ResultsConsumer] Dropping message without a result:", popped.slice(0, 200));
    await client.lRem(RESULTS_PROCESSING_KEY, 1, popped);
    return;
  }

  if (upsertAuditResult(job)) {
    await client.lRem(RESULTS_PROCESSING_KEY, 1, popped);
  }
  // On failure, the message stays in RESULTS_PROCESSING_KEY and recoverAbandonedJobs() on the
  // next startup (or a future retry loop) puts it back in front of the queue.
}

/** Runs forever, moving finished audits from Redis into `audit_results`. A message that already
 * made it to the processing list when the Producer last stopped is requeued once, at startup. */
export async function startResultsConsumer(redisUrl: string): Promise<void> {
  const client = createClient({ url: redisUrl });
  client.on("error", (error) => console.error("[ResultsConsumer] Redis client error", error));
  await client.connect();
  await recoverAbandonedJobs(client);

  console.log("[ResultsConsumer] Started, waiting for results...");
  for (;;) {
    try {
      await consumeOne(client);
    } catch (error) {
      console.error("[ResultsConsumer] Error consuming a result:", errorMessage(error));
    }
  }
}
