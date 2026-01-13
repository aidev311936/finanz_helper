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

export async function listAccounts(token) {
  const r = await pool.query(
    `SELECT id, bank_name, alias, handle
     FROM accounts
     WHERE token=$1
     ORDER BY id ASC`,
    [token]
  );
  return r.rows;
}

export async function spendingSummaryMonth(token, ym) {
  const { start, end } = monthRange(ym);

  const totalR = await pool.query(
    `SELECT COALESCE(SUM(booking_amount_value),0) AS total,
            COUNT(*)::int AS count
     FROM masked_transactions
     WHERE token=$1 AND booking_date_iso >= $2 AND booking_date_iso < $3`,
    [token, start.toISOString(), end.toISOString()]
  );

  const byCategory = await pool.query(
    `SELECT COALESCE(booking_category,'Unkategorisiert') AS category,
            COALESCE(SUM(booking_amount_value),0) AS total,
            COUNT(*)::int AS count
     FROM masked_transactions
     WHERE token=$1 AND booking_date_iso >= $2 AND booking_date_iso < $3
     GROUP BY COALESCE(booking_category,'Unkategorisiert')
     ORDER BY total DESC
     LIMIT 12`,
    [token, start.toISOString(), end.toISOString()]
  );

  const byAccount = await pool.query(
    `SELECT a.alias AS account_alias, a.bank_name,
            COALESCE(SUM(t.booking_amount_value),0) AS total,
            COUNT(*)::int AS count
     FROM masked_transactions t
     JOIN accounts a ON a.id=t.account_id
     WHERE t.token=$1 AND t.booking_date_iso >= $2 AND t.booking_date_iso < $3
     GROUP BY a.alias, a.bank_name
     ORDER BY total DESC`,
    [token, start.toISOString(), end.toISOString()]
  );

  return {
    month: ym,
    total: Number(Number(totalR.rows[0].total).toFixed(2)),
    count: totalR.rows[0].count,
    by_category: byCategory.rows.map((x) => ({
      category: x.category,
      total: Number(Number(x.total).toFixed(2)),
      count: x.count
    })),
    by_account: byAccount.rows.map((x) => ({
      bank: x.bank_name,
      alias: x.account_alias,
      total: Number(Number(x.total).toFixed(2)),
      count: x.count
    }))
  };
}

export async function topMerchantsMonth(token, ym, limit = 10) {
  const { start, end } = monthRange(ym);
  const r = await pool.query(
    `SELECT COALESCE(NULLIF(merchant_normalized,''), booking_text) AS merchant,
            COALESCE(SUM(booking_amount_value),0) AS total,
            COUNT(*)::int AS count
     FROM masked_transactions
     WHERE token=$1 AND booking_date_iso >= $2 AND booking_date_iso < $3
     GROUP BY COALESCE(NULLIF(merchant_normalized,''), booking_text)
     ORDER BY total DESC
     LIMIT $4`,
    [token, start.toISOString(), end.toISOString(), Number(limit)]
  );
  return r.rows.map((x) => ({
    merchant: x.merchant,
    total: Number(Number(x.total).toFixed(2)),
    count: x.count
  }));
}

export async function listSubscriptionsMonth(token, ym) {
  const { start, end } = monthRange(ym);
  const r = await pool.query(
    `SELECT t.id, t.bank_name, a.alias AS account_alias,
            t.booking_amount_value, t.booking_text, t.booking_type,
            t.booking_category, t.booking_date_iso,
            t.merchant_normalized, t.subscription_period, t.is_recurring
     FROM masked_transactions t
     JOIN accounts a ON a.id=t.account_id
     WHERE t.token=$1
       AND t.booking_date_iso >= $2 AND t.booking_date_iso < $3
       AND (
         t.is_subscription = true
         OR t.booking_category ILIKE '%abo%'
         OR t.is_recurring = true
       )
     ORDER BY t.booking_amount_value DESC NULLS LAST
     LIMIT 50`,
    [token, start.toISOString(), end.toISOString()]
  );
  return r.rows;
}

export async function fixedVsVariableMonth(token, ym) {
  const { start, end } = monthRange(ym);
  // Very pragmatic rule-set for Phase 1:
  // fixed = subscriptions/recurring + rent + insurances + utilities + phone/internet
  const fixedR = await pool.query(
    `SELECT COALESCE(SUM(booking_amount_value),0) AS fixed
     FROM masked_transactions
     WHERE token=$1 AND booking_date_iso >= $2 AND booking_date_iso < $3
       AND (
         is_subscription = true
         OR is_recurring = true
         OR booking_category ILIKE '%miete%'
         OR booking_category ILIKE '%versicherung%'
         OR booking_category ILIKE '%nebenkosten%'
         OR booking_text ILIKE '%strom%'
         OR booking_text ILIKE '%gas%'
         OR booking_text ILIKE '%internet%'
         OR booking_text ILIKE '%telefon%'
       )`,
    [token, start.toISOString(), end.toISOString()]
  );

  const totalR = await pool.query(
    `SELECT COALESCE(SUM(booking_amount_value),0) AS total
     FROM masked_transactions
     WHERE token=$1 AND booking_date_iso >= $2 AND booking_date_iso < $3`,
    [token, start.toISOString(), end.toISOString()]
  );

  const fixed = Number(Number(fixedR.rows[0].fixed).toFixed(2));
  const total = Number(Number(totalR.rows[0].total).toFixed(2));
  const variable = Number(Math.max(0, total - fixed).toFixed(2));
  return { month: ym, total, fixed, variable };
}

export async function savingsIdeasMonth(token, ym) {
  const summary = await spendingSummaryMonth(token, ym);
  const subs = await listSubscriptionsMonth(token, ym);
  const topMerchants = await topMerchantsMonth(token, ym, 10);

  // Simple heuristics for the MVP. The assistant will turn this into human text.
  return {
    month: ym,
    total: summary.total,
    top_categories: summary.by_category.slice(0, 6),
    top_merchants: topMerchants.slice(0, 8),
    subscription_candidates: subs
      .slice(0, 10)
      .map((t) => ({
        id: t.id,
        merchant: t.merchant_normalized || t.booking_text,
        amount: t.booking_amount_value,
        category: t.booking_category,
        date: t.booking_date_iso,
        recurring: t.is_recurring,
        period: t.subscription_period
      }))
  };
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
    name: "listAccounts",
    description: "Listet die Konten (Bank + Konto-Alias), die der Nutzer angelegt hat.",
    args: {}
  },
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
    name: "spendingSummaryMonth",
    description: "Gibt eine Monatsübersicht zurück: Gesamtsumme, Top-Kategorien, Top-Konten.",
    args: { month: "YYYY-MM" }
  },
  {
    name: "topMerchantsMonth",
    description: "Top Händler/Merchants in einem Monat (nach Summe), nutzt merchant_normalized falls vorhanden.",
    args: { month: "YYYY-MM", limit: "number" }
  },
  {
    name: "listSubscriptionsMonth",
    description: "Listet Abo/Recurring-Kandidaten in einem Monat (max 50).",
    args: { month: "YYYY-MM" }
  },
  {
    name: "fixedVsVariableMonth",
    description: "Schätzt Fixkosten vs variable Kosten in einem Monat (heuristisch).",
    args: { month: "YYYY-MM" }
  },
  {
    name: "savingsIdeasMonth",
    description: "Gibt strukturierte Hinweise für Sparpotenziale (Top Kategorien, Top Händler, Abos) für einen Monat.",
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
  if (name === "listAccounts") return await listAccounts(token);
  if (name === "listAvailableMonths") return await listAvailableMonths(token);
  if (name === "spendingByDay") return await spendingByDay(token, String(args.date));
  if (name === "mostExpensiveSubscription") return await mostExpensiveSubscription(token, String(args.month));
  if (name === "spendingSummaryMonth") return await spendingSummaryMonth(token, String(args.month));
  if (name === "topMerchantsMonth") return await topMerchantsMonth(token, String(args.month), args.limit ?? 10);
  if (name === "listSubscriptionsMonth") return await listSubscriptionsMonth(token, String(args.month));
  if (name === "fixedVsVariableMonth") return await fixedVsVariableMonth(token, String(args.month));
  if (name === "savingsIdeasMonth") return await savingsIdeasMonth(token, String(args.month));
  if (name === "transactionById") return await transactionById(token, Number(args.id));
  throw new Error(`unknown_tool_${name}`);
}
