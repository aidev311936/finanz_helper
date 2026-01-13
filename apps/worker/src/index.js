import { claimJob, markDone, markFailed } from "./jobs.js";
import { categorizeImport } from "./categorize.js";

const workerId = process.env.WORKER_ID || "worker-1";

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

console.log(`[worker] started as ${workerId}`);

while (true) {
  const job = await claimJob(workerId);
  if (!job) {
    await sleep(700);
    continue;
  }

  try {
    if (job.type === "categorize_import") {
      const importId = job.payload?.import_id;
      await categorizeImport(importId, job.token);
    }
    await markDone(job.id);
  } catch (e) {
    console.error("[worker] job failed", job.id, e);
    await markFailed(job.id, e?.message || String(e));
  }
}
