import { pool } from "./db.js";
import { LLM } from "./llm/provider.js";

const llm = new LLM();

// Phase-1 taxonomy: simple, human-readable paths that you can refine later.
// The LLM must pick one of these or create a compatible new path.
const TAXONOMY = [
  "Freizeit>Unterhaltung>Streaming Abo",
  "Freizeit>Unterhaltung>Musik Abo",
  "Freizeit>Unterhaltung>Gaming Abo",
  "Freizeit>Sport>Fitnessstudio",
  "Lebensunterhalt>Einkauf>Supermarkt",
  "Lebensunterhalt>Einkauf>Drogerie",
  "Lebensunterhalt>Haushalt>Miete",
  "Lebensunterhalt>Haushalt>Nebenkosten",
  "Lebensunterhalt>Mobilität>Tanken",
  "Lebensunterhalt>Mobilität>ÖPNV",
  "Versicherung>Haftpflicht",
  "Versicherung>Hausrat",
  "Versicherung>Krankenversicherung",
  "Versicherung>Kfz",
  "Finanzen>Gebühren>Bankgebühren",
  "Finanzen>Steuern",
  "Gesundheit>Arzt/Apotheke",
  "Einnahmen>Gehalt",
  "Einnahmen>Sonstiges",
  "Sonstiges"
];

function normalizeMerchantFallback(text) {
  // Deterministic fallback if the model doesn't return a merchant.
  // booking_text is already anonymized; we still keep this conservative.
  const t = String(text || "");
  const cleaned = t
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "UNBEKANNT";
  // Prefer the first 1-3 tokens as a short merchant label.
  return cleaned.split(" ").slice(0, 3).join(" ").slice(0, 32);
}

function toCategoryString(path) {
  if (Array.isArray(path)) return path.filter(Boolean).join(">");
  return String(path || "");
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

async function loadGroups(importId, token) {
  const r = await pool.query(
    `SELECT id, booking_text, booking_type, booking_amount_value
     FROM masked_transactions
     WHERE token=$1 AND import_id=$2 AND (booking_category IS NULL OR booking_category = '')
     ORDER BY id ASC`,
    [token, importId]
  );

  const groups = new Map();
  for (const row of r.rows) {
    const key = row.booking_text || "";
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        ids: [],
        sample_text: key,
        sample_type: row.booking_type || "",
        count: 0,
        min: null,
        max: null,
      });
    }
    const g = groups.get(key);
    g.ids.push(row.id);
    g.count += 1;
    const v = row.booking_amount_value == null ? null : Number(row.booking_amount_value);
    if (v != null && Number.isFinite(v)) {
      g.min = g.min == null ? v : Math.min(g.min, v);
      g.max = g.max == null ? v : Math.max(g.max, v);
    }
  }
  return Array.from(groups.values());
}

async function categorizeBatch(items) {
  const system = `
Du bist ein Klassifikationsservice für anonymisierte Bankumsätze.

Du bekommst "booking_text" (bereits anonymisiert/gekürzt) + optional Typ + Betragsrange.
Gib für jede Position eine Kategorie als Pfad zurück.

Taxonomie (bevorzugt):\n- ${TAXONOMY.join("\n- ")}

Regeln:
- Antworte als JSON Array mit gleicher Reihenfolge und Länge wie input.
- Jedes Element: {
    "key":"...",
    "merchant":"KURZER MERCHANT NAME",
    "category":"A>B>C",
    "confidence":0..1,
    "is_subscription": true|false,
    "subscription_period": "monthly"|"yearly"|"unknown"
  }
- category muss ein Pfad mit '>' sein. Wenn unsicher: 'Sonstiges'.
- merchant soll kurz, stabil und in GROSSBUCHSTABEN sein (z.B. "NETFLIX", "LIDL", "AMAZON").
- subscription_period nur setzen, wenn is_subscription=true.
- Kein Markdown, keine Erklärung.
`;

  const user = {
    items: items.map((it) => ({
      key: it.key,
      booking_text: it.sample_text,
      booking_type: it.sample_type,
      count: it.count,
      amount_min: it.min,
      amount_max: it.max
    }))
  };

  const out = await llm.generateJson([
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(user) }
  ]);

  if (!Array.isArray(out)) throw new Error("categorize_invalid_output");
  const map = new Map();
  for (const row of out) {
    const key = String(row?.key || "");
    if (!key) continue;
    map.set(key, {
      merchant: String(row?.merchant || "").trim(),
      category: toCategoryString(row?.category),
      confidence: clamp01(row?.confidence),
      is_subscription: Boolean(row?.is_subscription),
      subscription_period: String(row?.subscription_period || "").trim() || null
    });
  }
  return map;
}

async function updateRecurringFlags(token) {
  // Step 4 fallback heuristic (kept for compatibility):
  // merchant appears in >=3 distinct months (last 18 months) => recurring.
  await pool.query(
    `WITH m AS (
       SELECT merchant_normalized
       FROM masked_transactions
       WHERE token=$1
         AND merchant_normalized IS NOT NULL AND merchant_normalized <> ''
         AND booking_date_iso IS NOT NULL
         AND booking_date_iso >= (now() - interval '18 months')
       GROUP BY merchant_normalized
       HAVING COUNT(*) >= 3
          AND COUNT(DISTINCT to_char(date_trunc('month', booking_date_iso), 'YYYY-MM')) >= 3
     )
     UPDATE masked_transactions t
     SET is_recurring = true
     WHERE t.token=$1
       AND t.merchant_normalized IN (SELECT merchant_normalized FROM m)`,
    [token]
  );
}

function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

function daysBetween(a, b) {
  const ms = Math.abs(b.getTime() - a.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

function isMonthlyGap(d) {
  return d >= 25 && d <= 35;
}

function isYearlyGap(d) {
  return d >= 330 && d <= 400;
}

async function updateSubscriptionPatterns(token) {
  // Step 5: stronger recurring/subscription detection using amount+interval patterns.
  // Uses only anonymized fields (merchant_normalized, amount, booking_date_iso).
  const r = await pool.query(
    `SELECT id, merchant_normalized, booking_amount_value, booking_date_iso,
            COALESCE(booking_category,'') AS booking_category,
            COALESCE(is_subscription,false) AS is_subscription
     FROM masked_transactions
     WHERE token=$1
       AND merchant_normalized IS NOT NULL AND merchant_normalized <> ''
       AND booking_amount_value IS NOT NULL
       AND booking_amount_value > 0
       AND booking_date_iso IS NOT NULL
       AND booking_date_iso >= (now() - interval '24 months')
     ORDER BY merchant_normalized ASC, booking_amount_value ASC, booking_date_iso ASC`,
    [token]
  );

  const groups = new Map();
  for (const row of r.rows) {
    const amt = round2(row.booking_amount_value);
    if (amt == null) continue;
    const merchant = String(row.merchant_normalized || '').trim();
    if (!merchant) continue;
    const key = `${merchant}|${amt.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      id: row.id,
      date: new Date(row.booking_date_iso),
      category: String(row.booking_category || ''),
      alreadySub: Boolean(row.is_subscription)
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [key, items] of groups.entries()) {
      if (items.length < 2) continue;
      items.sort((a, b) => a.date.getTime() - b.date.getTime());

      const months = new Set(items.map(it => `${it.date.getUTCFullYear()}-${String(it.date.getUTCMonth()+1).padStart(2,'0')}`));
      const deltas = [];
      for (let i = 1; i < items.length; i++) {
        deltas.push(daysBetween(items[i-1].date, items[i].date));
      }
      const monthlyGaps = deltas.filter(isMonthlyGap).length;
      const yearlyGaps = deltas.filter(isYearlyGap).length;

      let period = null;
      let score = 0;
      if (items.length >= 3 && monthlyGaps >= 2) {
        period = 'monthly';
        score = monthlyGaps / Math.max(1, deltas.length);
      } else if (yearlyGaps >= 1) {
        period = 'yearly';
        score = yearlyGaps / Math.max(1, deltas.length);
      }

      const computedRecurring = (months.size >= 3 && items.length >= 3) || period !== null;
      const categoryHintsSub = items.some(it => /abo|versicherung|miete|internet|telefon/i.test(it.category));
      const computedSub = Boolean(period) || categoryHintsSub;
      const keepExistingSub = items.some(it => it.alreadySub);

      // Update rows in this group
      const ids = items.map(it => it.id);
      await client.query(
        `UPDATE masked_transactions
         SET subscription_key = $1,
             recurrence_score = $2,
             is_recurring = COALESCE(is_recurring,false) OR $3,
             is_subscription = COALESCE(is_subscription,false) OR $4,
             subscription_period = CASE
               WHEN $5 IS NULL THEN subscription_period
               WHEN subscription_period IS NULL OR subscription_period = '' OR subscription_period = 'unknown' THEN $5
               ELSE subscription_period
             END
         WHERE token=$6 AND id = ANY($7::bigint[])`,
        [key, score, computedRecurring, (keepExistingSub || computedSub), period, token, ids]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function categorizeImport(importId, token) {
  const groups = await loadGroups(importId, token);
  if (groups.length === 0) return;

  // Process in manageable batches.
  const BATCH = 30;
  const client = await pool.connect();
  try {
    for (let i = 0; i < groups.length; i += BATCH) {
      const slice = groups.slice(i, i + BATCH);
      const resultMap = await categorizeBatch(slice);

      await client.query("BEGIN");
      for (const g of slice) {
        const r = resultMap.get(g.key);
        const category = r?.category || "Sonstiges";
        const confidence = r?.confidence ?? 0;
        const merchant = (r?.merchant || "").trim() || normalizeMerchantFallback(g.sample_text);
        const isSubscription = r?.is_subscription ?? false;
        const period = isSubscription ? (r?.subscription_period || "unknown") : null;

        await client.query(
          `UPDATE masked_transactions
           SET booking_category=$1,
               category_confidence=$2,
               category_source=$3,
               merchant_normalized=$4,
               is_subscription=$5,
               subscription_period=$6
           WHERE id = ANY($7::bigint[])`,
          [category, confidence, "llm", merchant, isSubscription, period, g.ids]
        );
      }
      await client.query("COMMIT");
    }
    await updateRecurringFlags(token);
    // Step 5: enrich recurring/subscription signals using amount+interval patterns.
    try {
      await updateSubscriptionPatterns(token);
    } catch {
      // Don't fail the job if this enrichment step hits an unexpected edge case.
    }
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
