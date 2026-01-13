import { pool } from "./db.js";

/**
 * Phase 1:
 * - Hol alle tx eines imports ohne booking_category
 * - Gruppiere nach booking_text (maskiert)
 * - (TODO) KI call pro Gruppe -> category_path + confidence
 * - Update alle tx der Gruppe
 */
export async function categorizeImport(importId, token) {
  const r = await pool.query(
    `SELECT id, booking_text
     FROM masked_transactions
     WHERE token=$1 AND import_id=$2 AND (booking_category IS NULL OR booking_category = '')
     ORDER BY id ASC`,
    [token, importId]
  );

  if (r.rowCount === 0) return;

  // naive grouping by booking_text
  const groups = new Map();
  for (const row of r.rows) {
    const k = row.booking_text || "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row.id);
  }

  // TODO: Replace with actual provider categorization
  // For now: set "Unkategorisiert"
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [text, ids] of groups.entries()) {
      await client.query(
        `UPDATE masked_transactions
         SET booking_category = $1,
             category_confidence = $2,
             category_source = $3
         WHERE id = ANY($4::bigint[])`,
        ["Unkategorisiert", 0.0, "rule", ids]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
