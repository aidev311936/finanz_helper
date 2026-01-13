import { pool } from "../db.js";

function monthRange(ym) {
  // ym: YYYY-MM
  const [y, m] = ym.split("-").map((x) => parseInt(x, 10));
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return { start, end };
}

export async function listAvailableMonths(token) {
  const r = await pool.query(
    `SELECT DISTINCT to_char(date_trunc('month', booking_date_iso), 'YYYY-MM') AS ym
     FROM masked_transactions
     WHERE token=$1 AND booking_date_iso IS NOT NULL
     ORDER BY ym DESC
     LIMIT 60`,
    [token]
  );
  return r.rows.map((x) => x.ym);
}

export async function spendingByDay(token, dateIso) {
  // dateIso: YYYY-MM-DD
  const start = new Date(`${dateIso}T00:00:00Z`);
  const end = new Date(`${dateIso}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  const r = await pool.query(
    `SELECT t.id, t.bank_name, a.alias AS account_alias, t.booking_amount_value,
            t.booking_text, t.booking_type, t.booking_category, t.booking_date_iso
     FROM masked_transactions t
     JOIN accounts a ON a.id=t.account_id
     WHERE t.token=$1 AND t.booking_date_iso >= $2 AND t.booking_date_iso < $3
     ORDER BY t.booking_amount_value DESC NULLS LAST, t.id ASC`,
    [token, start.toISOString(), end.toISOString()]
  );

  const total = r.rows.reduce((sum, row) => sum + (Number(row.booking_amount_value) || 0), 0);
  return { date: dateIso, total: Number(total.toFixed(2)), rows: r.rows };
}

export async function mostExpensiveSubscription(token, ym) {
  const { start, end } = monthRange(ym);

  // Heuristik: Kategorien mit "Abo" ODER typische Subscription-Händler.
  const r = await pool.query(
    `SELECT t.id, t.bank_name, a.alias AS account_alias, t.booking_amount_value,
            t.booking_text, t.booking_type, t.booking_category, t.booking_date_iso
     FROM masked_transactions t
     JOIN accounts a ON a.id=t.account_id
     WHERE t.token=$1
       AND t.booking_date_iso >= $2 AND t.booking_date_iso < $3
       AND (
         (t.booking_category ILIKE '%abo%')
         OR (t.booking_text ILIKE '%netflix%')
         OR (t.booking_text ILIKE '%spotify%')
         OR (t.booking_text ILIKE '%prime%')
         OR (t.booking_text ILIKE '%amazon%prime%')
         OR (t.booking_text ILIKE '%disney%')
         OR (t.booking_text ILIKE '%apple%')
         OR (t.booking_text ILIKE '%google%')
       )
     ORDER BY t.booking_amount_value DESC NULLS LAST
     LIMIT 1`,
    [token, start.toISOString(), end.toISOString()]
  );

  return r.rows[0] || null;
}

export async function transactionById(token, id) {
  const r = await pool.query(
    `SELECT t.id, t.bank_name, a.alias AS account_alias, t.booking_amount_value,
            t.booking_text, t.booking_type, t.booking_category, t.booking_date_iso
     FROM masked_transactions t
     JOIN accounts a ON a.id=t.account_id
     WHERE t.token=$1 AND t.id=$2`,
    [token, id]
  );
  return r.rows[0] || null;
}

export const TOOL_SPEC = [
  {
    name: "listAvailableMonths",
    description: "Listet Monate (YYYY-MM), für die Umsätze vorhanden sind.",
    args: {}
  },
  {
    name: "spendingByDay",
    description: "Zeigt alle Ausgaben an einem Tag (YYYY-MM-DD) und die Summe.",
    args: { date: "YYYY-MM-DD" }
  },
  {
    name: "mostExpensiveSubscription",
    description: "Findet das teuerste Abo in einem Monat (YYYY-MM).",
    args: { month: "YYYY-MM" }
  },
  {
    name: "transactionById",
    description: "Gibt Details zu einer Transaktion anhand ihrer ID.",
    args: { id: "number" }
  }
];

export async function runTool(token, tool) {
  const name = tool?.name;
  const args = tool?.args || {};
  if (name === "listAvailableMonths") return await listAvailableMonths(token);
  if (name === "spendingByDay") return await spendingByDay(token, String(args.date));
  if (name === "mostExpensiveSubscription") return await mostExpensiveSubscription(token, String(args.month));
  if (name === "transactionById") return await transactionById(token, Number(args.id));
  throw new Error(`unknown_tool_${name}`);
}
