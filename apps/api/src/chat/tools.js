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
  const dupSubs = await duplicateSubscriptionsMonth(token, ym);
  const budgetStatus = await budgetStatusMonth(token, ym);

  // Simple heuristics for the MVP. The assistant will turn this into human text.
  return {
    month: ym,
    total: summary.total,
    top_categories: summary.by_category.slice(0, 6),
    top_merchants: topMerchants.slice(0, 8),
    duplicate_subscription_groups: dupSubs,
    budget_status: budgetStatus,
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

function bucketForSubscription(category, merchant) {
  const c = String(category || "").toLowerCase();
  const m = String(merchant || "").toLowerCase();
  const x = `${c} ${m}`;

  if (/stream|netflix|disney|prime|amazon\s*prime|wow|sky|rtl\+|joyn|dazn/.test(x)) return "Streaming";
  if (/musik|spotify|apple\s*music|deezer|soundcloud/.test(x)) return "Musik";
  if (/gaming|xbox|playstation|psn|steam|nintendo/.test(x)) return "Gaming";
  if (/versicherung|haftpflicht|hausrat|kfz|kranken/.test(x)) return "Versicherung";
  if (/telefon|internet|mobilfunk|vodafone|telekom|o2|1\&1/.test(x)) return "Internet/Telefon";
  if (/miete|nebenkosten|strom|gas|wasser|heizung/.test(x)) return "Wohnen/Nebenkosten";
  return "Sonstiges";
}

export async function subscriptionSummaryMonth(token, ym) {
  const rows = await listSubscriptionsMonth(token, ym);
  const items = rows.map((t) => {
    const merchant = t.merchant_normalized || t.booking_text;
    return {
      id: t.id,
      merchant,
      bucket: bucketForSubscription(t.booking_category, merchant),
      amount: Number(t.booking_amount_value || 0),
      period: t.subscription_period || "unknown",
      recurring: Boolean(t.is_recurring),
      category: t.booking_category || ""
    };
  });

  const byBucket = new Map();
  for (const it of items) {
    if (!byBucket.has(it.bucket)) byBucket.set(it.bucket, { bucket: it.bucket, total: 0, count: 0 });
    const b = byBucket.get(it.bucket);
    b.total += it.amount || 0;
    b.count += 1;
  }

  const buckets = Array.from(byBucket.values())
    .map((b) => ({ bucket: b.bucket, total: Number(b.total.toFixed(2)), count: b.count }))
    .sort((a, b) => b.total - a.total);

  // Convenience: estimated monthly total (yearly subs divided by 12)
  const estimatedMonthly = items.reduce((sum, it) => {
    const amt = it.amount || 0;
    if (it.period === "yearly") return sum + amt / 12;
    return sum + amt;
  }, 0);

  return {
    month: ym,
    estimated_monthly_total: Number(estimatedMonthly.toFixed(2)),
    buckets,
    items: items
      .sort((a, b) => (b.amount || 0) - (a.amount || 0))
      .slice(0, 60)
  };
}

export async function cancellationCandidatesMonth(token, ym) {
  const summary = await subscriptionSummaryMonth(token, ym);
  const duplicates = await duplicateSubscriptionsMonth(token, ym);

  const expensive = summary.items
    .filter((it) => (it.period === "monthly" || it.period === "unknown") && it.amount >= 12)
    .slice(0, 12);

  // Pick duplicate buckets first
  const dupHints = duplicates.map((d) => ({
    category: d.category,
    total: d.total,
    merchants: d.merchants
  }));

  return {
    month: ym,
    duplicate_groups: dupHints,
    expensive_candidates: expensive.map((e) => ({
      id: e.id,
      merchant: e.merchant,
      amount: Number(e.amount.toFixed(2)),
      bucket: e.bucket,
      period: e.period,
      category: e.category
    }))
  };
}

export async function budgetSuggestionsMonth(token, ym) {
  const summary = await spendingSummaryMonth(token, ym);
  const budgets = await listBudgets(token);
  const budgetMap = new Map(budgets.map((b) => [b.category, b.monthly_limit]));

  // Suggest budgets for the top categories with meaningful spend.
  const suggestions = summary.by_category
    .filter((c) => c.total >= 20)
    .slice(0, 8)
    .map((c) => {
      const spent = Number(c.total);
      const existing = budgetMap.get(c.category);
      // suggested = 90% of last month's spend, rounded to nearest 10
      const suggested = Math.max(10, Math.round((spent * 0.9) / 10) * 10);
      return {
        category: c.category,
        spent: Number(spent.toFixed(2)),
        existing_limit: existing != null ? Number(Number(existing).toFixed(2)) : null,
        suggested_limit: Number(Number(suggested).toFixed(2))
      };
    });

  return { month: ym, suggestions };
}

export async function listBudgets(token) {
  const r = await pool.query(
    `SELECT category, monthly_limit
     FROM budgets
     WHERE token=$1
     ORDER BY category ASC`,
    [token]
  );
  return r.rows.map((x) => ({
    category: x.category,
    monthly_limit: Number(Number(x.monthly_limit).toFixed(2))
  }));
}

export async function setBudget(token, category, monthlyLimit) {
  const cat = String(category || '').trim();
  const limit = Number(monthlyLimit);
  if (!cat) throw new Error('budget_category_required');
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('budget_limit_invalid');

  const r = await pool.query(
    `INSERT INTO budgets(token, category, monthly_limit)
     VALUES($1,$2,$3)
     ON CONFLICT (token, category)
     DO UPDATE SET monthly_limit=EXCLUDED.monthly_limit, updated_on=now()
     RETURNING category, monthly_limit`,
    [token, cat, limit]
  );
  return {
    category: r.rows[0].category,
    monthly_limit: Number(Number(r.rows[0].monthly_limit).toFixed(2))
  };
}

export async function budgetStatusMonth(token, ym) {
  const budgets = await listBudgets(token);
  if (budgets.length === 0) return { month: ym, budgets: [] };

  const { start, end } = monthRange(ym);
  const r = await pool.query(
    `SELECT COALESCE(booking_category,'Unkategorisiert') AS category,
            COALESCE(SUM(booking_amount_value),0) AS total
     FROM masked_transactions
     WHERE token=$1 AND booking_date_iso >= $2 AND booking_date_iso < $3
     GROUP BY COALESCE(booking_category,'Unkategorisiert')`,
    [token, start.toISOString(), end.toISOString()]
  );

  const totals = new Map(r.rows.map((x) => [x.category, Number(x.total)]));
  const out = budgets.map((b) => {
    const spent = Number((totals.get(b.category) || 0).toFixed(2));
    const remaining = Number((b.monthly_limit - spent).toFixed(2));
    return {
      category: b.category,
      limit: b.monthly_limit,
      spent,
      remaining,
      status: spent > b.monthly_limit ? 'over' : 'ok'
    };
  });
  return { month: ym, budgets: out };
}

export async function duplicateSubscriptionsMonth(token, ym) {
  const { start, end } = monthRange(ym);
  const r = await pool.query(
    `SELECT COALESCE(NULLIF(booking_category,''),'Unkategorisiert') AS category,
            COALESCE(NULLIF(merchant_normalized,''), booking_text) AS merchant,
            COALESCE(SUM(booking_amount_value),0) AS total
     FROM masked_transactions
     WHERE token=$1
       AND booking_date_iso >= $2 AND booking_date_iso < $3
       AND (
         is_subscription = true
         OR is_recurring = true
         OR booking_category ILIKE '%abo%'
       )
     GROUP BY COALESCE(NULLIF(booking_category,''),'Unkategorisiert'),
              COALESCE(NULLIF(merchant_normalized,''), booking_text)
     ORDER BY category ASC, total DESC`,
    [token, start.toISOString(), end.toISOString()]
  );

  const byCat = new Map();
  for (const row of r.rows) {
    const cat = row.category;
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push({
      merchant: row.merchant,
      total: Number(Number(row.total).toFixed(2))
    });
  }

  // Duplicates = >=2 merchants in same category bucket.
  const dup = [];
  for (const [cat, rows] of byCat.entries()) {
    const merchants = new Set(rows.map((x) => x.merchant));
    if (merchants.size >= 2 && /abo|streaming|musik|gaming|versicherung/i.test(cat)) {
      const sum = rows.reduce((s, x) => s + x.total, 0);
      dup.push({
        category: cat,
        merchants: rows.slice(0, 8),
        total: Number(sum.toFixed(2))
      });
    }
  }
  return dup;
}

export async function alertsMonth(token, ym) {
  const budgetStatus = await budgetStatusMonth(token, ym);

  // Anomaly alerts vs last 3 months average by category.
  const { start, end } = monthRange(ym);
  const prevStart = new Date(start);
  prevStart.setUTCMonth(prevStart.getUTCMonth() - 3);

  const hist = await pool.query(
    `SELECT to_char(date_trunc('month', booking_date_iso), 'YYYY-MM') AS ym,
            COALESCE(booking_category,'Unkategorisiert') AS category,
            COALESCE(SUM(booking_amount_value),0) AS total
     FROM masked_transactions
     WHERE token=$1
       AND booking_date_iso >= $2 AND booking_date_iso < $3
     GROUP BY 1,2`,
    [token, prevStart.toISOString(), end.toISOString()]
  );

  const byCat = new Map();
  for (const row of hist.rows) {
    const cat = row.category;
    const month = row.ym;
    const total = Number(row.total);
    if (!byCat.has(cat)) byCat.set(cat, new Map());
    byCat.get(cat).set(month, total);
  }

  const anomalies = [];
  for (const [cat, monthMap] of byCat.entries()) {
    const current = monthMap.get(ym) || 0;
    // average of previous 3 months (excluding current)
    const prevMonths = Array.from(monthMap.entries()).filter(([m]) => m !== ym).map(([,v]) => v);
    if (prevMonths.length === 0) continue;
    const avg = prevMonths.reduce((s,v)=>s+v,0) / prevMonths.length;
    if (current >= 30 && avg > 0 && current > avg * 1.3) {
      anomalies.push({
        category: cat,
        current: Number(current.toFixed(2)),
        average_prev: Number(avg.toFixed(2)),
        increase_pct: Number(((current/avg - 1) * 100).toFixed(0))
      });
    }
  }

  const overBudgets = budgetStatus.budgets.filter((b) => b.status === 'over');
  return {
    month: ym,
    over_budgets: overBudgets,
    anomalies: anomalies.sort((a,b) => (b.current - a.current)).slice(0, 12)
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
    name: "subscriptionSummaryMonth",
    description: "Fasst Abos/Recurring in einem Monat zusammen (Buckets wie Streaming/Musik/Versicherung) inkl. geschätzter Monats-Gesamtsumme.",
    args: { month: "YYYY-MM" }
  },
  {
    name: "cancellationCandidatesMonth",
    description: "Gibt Kündigungs-/Prüf-Kandidaten für Abos in einem Monat zurück (Duplikate + teure Kandidaten).",
    args: { month: "YYYY-MM" }
  },
  {
    name: "duplicateSubscriptionsMonth",
    description: "Findet mögliche doppelte Abos (mehrere Merchants in ähnlichen Abo-Kategorien) in einem Monat.",
    args: { month: "YYYY-MM" }
  },
  {
    name: "listBudgets",
    description: "Listet gesetzte Monats-Budgets pro Kategorie.",
    args: {}
  },
  {
    name: "budgetSuggestionsMonth",
    description: "Schlägt für einen Monat Budgets für Top-Kategorien vor (basierend auf Ausgaben und bestehenden Budgets).",
    args: { month: "YYYY-MM" }
  },
  {
    name: "setBudget",
    description: "Setzt/aktualisiert ein Monats-Budget für eine Kategorie.",
    args: { category: "A>B>C", monthly_limit: "number" }
  },
  {
    name: "budgetStatusMonth",
    description: "Zeigt für einen Monat, wie viel pro Budget-Kategorie ausgegeben wurde und ob das Budget überschritten ist.",
    args: { month: "YYYY-MM" }
  },
  {
    name: "alertsMonth",
    description: "Erstellt Warnungen für einen Monat (Budget überschritten, ungewöhnliche Anstiege vs Durchschnitt).",
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
  if (name === "duplicateSubscriptionsMonth") return await duplicateSubscriptionsMonth(token, String(args.month));
  if (name === "listBudgets") return await listBudgets(token);
  if (name === "setBudget") return await setBudget(token, String(args.category), args.monthly_limit);
  if (name === "budgetStatusMonth") return await budgetStatusMonth(token, String(args.month));
  if (name === "alertsMonth") return await alertsMonth(token, String(args.month));
  if (name === "budgetSuggestionsMonth") return await budgetSuggestionsMonth(token, String(args.month));
  if (name === "subscriptionSummaryMonth") return await subscriptionSummaryMonth(token, String(args.month));
  if (name === "cancellationCandidatesMonth") return await cancellationCandidatesMonth(token, String(args.month));
  if (name === "transactionById") return await transactionById(token, Number(args.id));
  throw new Error(`unknown_tool_${name}`);
}
