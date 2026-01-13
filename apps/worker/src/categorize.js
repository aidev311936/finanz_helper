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
- Jedes Element: {"key":"...","category":"A>B>C","confidence":0..1}
- category muss ein Pfad mit '>' sein. Wenn unsicher: 'Sonstiges'.
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
      category: toCategoryString(row?.category),
      confidence: clamp01(row?.confidence)
    });
  }
  return map;
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

        await client.query(
          `UPDATE masked_transactions
           SET booking_category=$1,
               category_confidence=$2,
               category_source=$3
           WHERE id = ANY($4::bigint[])`,
          [category, confidence, "llm", g.ids]
        );
      }
      await client.query("COMMIT");
    }
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
