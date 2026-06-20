/**
 * Long-running pipeline worker.
 *
 * Step 0: boots and logs "idle" on an interval. The job-claim loop and the call
 * into runPipeline() are added in Step 9 once the jobs/scenes tables exist.
 */
import { env } from "@/lib/env";
import { resolveTier } from "@/lib/models";
import { log } from "@/lib/log";

let running = true;

async function tick() {
  // Step 9 will replace this with: claim a queued job (FOR UPDATE SKIP LOCKED),
  // run runPipeline(job.source_url, job.tier), update status/progress.
  log.info(`worker idle — tier=${resolveTier()} pollMs=${env.WORKER_POLL_MS}`);
}

async function main() {
  log.info("worker starting");
  while (running) {
    try {
      await tick();
    } catch (err) {
      log.error("tick failed", err);
    }
    await new Promise((r) => setTimeout(r, env.WORKER_POLL_MS));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info(`received ${sig}, shutting down`);
    running = false;
    process.exit(0);
  });
}

main();
