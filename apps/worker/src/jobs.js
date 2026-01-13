import { pool } from "./db.js";

export async function claimJob(workerId) {
  const r = await pool.query(
    `
    WITH next_job AS (
      SELECT id
      FROM jobs
      WHERE status='queued' AND run_after <= now()
      ORDER BY created_on ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs
      SET status='running',
          locked_at=now(),
          locked_by=$1,
          attempts=attempts+1
    WHERE id IN (SELECT id FROM next_job)
    RETURNING *;
    `,
    [workerId]
  );
  return r.rows[0] || null;
}

export async function markDone(id) {
  await pool.query(`UPDATE jobs SET status='done' WHERE id=$1`, [id]);
}

export async function markFailed(id, err) {
  await pool.query(`UPDATE jobs SET status='failed', last_error=$2 WHERE id=$1`, [id, String(err).slice(0, 2000)]);
}
