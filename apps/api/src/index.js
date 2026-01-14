import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import { migrate } from "./migrate.js";
import { ensureToken, newToken, touchToken } from "./session.js";
import { pool } from "./db.js";
import { handleChat } from "./chat/assistant.js";

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser(process.env.COOKIE_SECRET || "dev"));

app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

function requireToken(req, res, next) {
  const token = req.cookies?.token || req.headers["x-token"];
  if (!token) return res.status(401).json({ error: "missing_token" });
  req.token = String(token);
  ensureToken(req.token).catch(() => { });
  next();
}

function requireSupport(req, res, next) {
  const expected = process.env.SUPPORT_TOKEN || "";
  const got = String(req.headers["x-support-token"] || "");
  if (!expected || got !== expected) return res.status(403).json({ error: "forbidden" });
  next();
}

// Session
app.post("/api/session", async (_req, res) => {
  const token = newToken();
  await ensureToken(token);
  res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
  res.json({ token });
});

// Bank mappings (frontend needs full mapping; no UI edit)
app.get("/api/bank-mapping", requireToken, async (_req, res) => {
  const r = await pool.query(
    `SELECT
        bank_name,
        booking_date,
        booking_text,
        booking_type,
        amount,
        booking_date_parse_format,
        without_header,
        detection_hints
     FROM bank_mapping
     ORDER BY bank_name ASC`
  );

  const mappings = r.rows.map((row) => ({
    bank_name: row.bank_name,
    booking_date: row.booking_date || [],
    booking_text: row.booking_text || [],
    booking_type: row.booking_type || [],
    booking_amount: row.amount || [],
    booking_date_parse_format: row.booking_date_parse_format || "",
    without_header: !!row.without_header,
    detection: row.detection_hints && Object.keys(row.detection_hints).length ? row.detection_hints : null,
  }));

  res.json({ mappings });
});

// Support can insert/update mappings (no user UI)
app.post("/api/support/bank-mapping", requireSupport, async (req, res) => {
  const m = req.body || {};
  const bank_name = String(m.bank_name || "").trim();
  if (!bank_name) return res.status(400).json({ error: "bank_name_required" });

  const booking_date = Array.isArray(m.booking_date) ? m.booking_date.map(String) : [];
  const booking_text = Array.isArray(m.booking_text) ? m.booking_text.map(String) : [];
  const booking_type = Array.isArray(m.booking_type) ? m.booking_type.map(String) : [];
  const amount = Array.isArray(m.booking_amount) ? m.booking_amount.map(String) : [];
  const booking_date_parse_format = String(m.booking_date_parse_format || "");
  const without_header = !!m.without_header;
  const detection_hints = (typeof m.detection === "object" && m.detection && !Array.isArray(m.detection)) ? m.detection : {};

  await pool.query(
    `INSERT INTO bank_mapping(
      bank_name, booking_date, booking_text, booking_type, amount,
      booking_date_parse_format, without_header, detection_hints
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (bank_name) DO UPDATE SET
       booking_date=EXCLUDED.booking_date,
       booking_text=EXCLUDED.booking_text,
       booking_type=EXCLUDED.booking_type,
       amount=EXCLUDED.amount,
       booking_date_parse_format=EXCLUDED.booking_date_parse_format,
       without_header=EXCLUDED.without_header,
       detection_hints=EXCLUDED.detection_hints`,
    [bank_name, booking_date, booking_text, booking_type, amount, booking_date_parse_format, without_header, detection_hints]
  );
  res.json({ ok: true });
});

// Unknown bank request
app.post("/api/bank-format-requests", requireToken, async (req, res) => {
  const bank_name = String(req.body?.bank_name || "").trim();
  if (!bank_name) return res.status(400).json({ error: "bank_name_required" });
  await pool.query(`INSERT INTO bank_format_requests(token, bank_name) VALUES ($1,$2)`, [req.token, bank_name]);
  res.json({ ok: true });
});

// Accounts
async function nextAccountHandle(token) {
  const r = await pool.query(`SELECT COUNT(*)::int AS c FROM accounts WHERE token=$1`, [token]);
  return `acc_${r.rows[0].c + 1}`;
}

app.get("/api/accounts", requireToken, async (req, res) => {
  const bank_name = req.query.bank_name ? String(req.query.bank_name) : null;
  const r = bank_name
    ? await pool.query(`SELECT id, bank_name, alias, handle FROM accounts WHERE token=$1 AND bank_name=$2 ORDER BY id ASC`, [req.token, bank_name])
    : await pool.query(`SELECT id, bank_name, alias, handle FROM accounts WHERE token=$1 ORDER BY id ASC`, [req.token]);
  res.json({ data: r.rows });
});

app.post("/api/accounts", requireToken, async (req, res) => {
  const bank_name = String(req.body?.bank_name || "").trim();
  const alias = String(req.body?.alias || "").trim();
  if (!bank_name) return res.status(400).json({ error: "bank_name_required" });
  if (!alias) return res.status(400).json({ error: "alias_required" });

  const handle = await nextAccountHandle(req.token);
  const r = await pool.query(
    `INSERT INTO accounts(token, bank_name, alias, handle)
     VALUES($1,$2,$3,$4)
     RETURNING id, bank_name, alias, handle`,
    [req.token, bank_name, alias, handle]
  );
  res.json({ data: r.rows[0] });
});

// Imports
app.post("/api/imports", requireToken, async (req, res) => {
  const account_id = Number(req.body?.account_id);
  if (!account_id) return res.status(400).json({ error: "account_id_required" });
  const r = await pool.query(
    `INSERT INTO imports(token, account_id) VALUES($1,$2) RETURNING id`,
    [req.token, account_id]
  );
  res.json({ data: { import_id: r.rows[0].id } });
});

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeFallbackHash(t, amountValue) {
  // Deterministic server-side fallback if client didn't send a hash.
  const raw = [
    t.bank_name ?? "",
    t.booking_date_iso ?? "",
    t.booking_date ?? "",
    t.booking_text ?? "",
    t.booking_type ?? "",
    amountValue ?? "",
    t.booking_amount ?? ""
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// Transactions bulk insert
app.post("/api/transactions/bulk", requireToken, async (req, res) => {
  const import_id = Number(req.body?.import_id);
  const account_id = Number(req.body?.account_id);
  const txs = Array.isArray(req.body?.transactions) ? req.body.transactions : [];
  if (!import_id) return res.status(400).json({ error: "import_id_required" });
  if (!account_id) return res.status(400).json({ error: "account_id_required" });

  let inserted = 0;
  let skipped_duplicates = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const t of txs) {
      let booking_hash = String(t.booking_hash || "").trim();
      const booking_date_iso = t.booking_date_iso || null;
      const booking_date_raw = t.booking_date_raw ? String(t.booking_date_raw) : null;
      const booking_date = t.booking_date ? String(t.booking_date) : null;
      const booking_text = String(t.booking_text || "");
      const booking_type = t.booking_type ? String(t.booking_type) : "";
      const booking_amount = t.booking_amount ? String(t.booking_amount) : null;
      const amount_value = toNumberOrNull(t.booking_amount_value);

      if (!booking_hash) {
        booking_hash = computeFallbackHash(t, amount_value);
      }

      if (!booking_text) {
        continue;
      }

      const r = await client.query(
        `INSERT INTO masked_transactions(
          token, account_id, import_id,
          bank_name, booking_date, booking_date_raw, booking_date_iso,
          booking_text, booking_type,
          booking_amount, booking_amount_value,
          booking_hash
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (account_id, booking_hash) DO NOTHING
        RETURNING id`,
        [
          req.token,
          account_id,
          import_id,
          t.bank_name || null,
          booking_date,
          booking_date_raw,
          booking_date_iso,
          booking_text,
          booking_type,
          booking_amount,
          amount_value,
          booking_hash,
        ]
      );
      if (r.rowCount === 1) inserted++;
      else skipped_duplicates++;
    }

    await client.query(
      `UPDATE imports SET tx_count = tx_count + $1 WHERE id=$2 AND token=$3`,
      [inserted, import_id, req.token]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[bulk] insert failed", e);
    return res.status(500).json({ error: "bulk_insert_failed" });
  } finally {
    client.release();
  }

  res.json({ data: { inserted, skipped_duplicates } });
});

// Enqueue categorization job
app.post("/api/categorization/run", requireToken, async (req, res) => {
  const import_id = Number(req.body?.import_id);
  if (!import_id) return res.status(400).json({ error: "import_id_required" });

  const r = await pool.query(
    `INSERT INTO jobs(token, type, payload)
     VALUES($1,'categorize_import', jsonb_build_object('import_id',$2::bigint))
     RETURNING id`,
    [req.token, import_id]
  );

  res.json({ data: { job_id: r.rows[0].id } });
});

// Anonymization rules
app.get("/api/anon-rules", requireToken, async (req, res) => {
  const r = await pool.query(
    `SELECT id, name, rule_type, pattern, flags, replacement, description, enabled
     FROM anon_rules
     WHERE token=$1 AND enabled=true
     ORDER BY created_on ASC`,
    [req.token]
  );
  res.json({ rules: r.rows });
});

app.post("/api/anon-rules", requireToken, async (req, res) => {
  const { name, pattern, flags, replacement, description } = req.body;

  if (!name || !pattern || !replacement) {
    return res.status(400).json({ error: "name_pattern_and_replacement_required" });
  }

  try {
    const r = await pool.query(
      `INSERT INTO anon_rules(token, name, rule_type, pattern, flags, replacement, description)
       VALUES($1, $2, 'regex', $3, $4, $5, $6)
       RETURNING id, name, rule_type, pattern, flags, replacement, description`,
      [req.token, name.trim(), pattern, flags || 'gi', replacement, description || null]
    );
    res.json({ rule: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') { // Unique violation
      return res.status(409).json({ error: "rule_name_already_exists" });
    }
    throw e;
  }
});

app.put("/api/anon-rules/:id", requireToken, async (req, res) => {
  const id = Number(req.params.id);
  const { name, pattern, flags, replacement, description, enabled } = req.body;

  try {
    const r = await pool.query(
      `UPDATE anon_rules
       SET name=COALESCE($1, name),
           pattern=COALESCE($2, pattern),
           flags=COALESCE($3, flags),
           replacement=COALESCE($4, replacement),
           description=COALESCE($5, description),
           enabled=COALESCE($6, enabled)
       WHERE id=$7 AND token=$8
       RETURNING id, name, rule_type, pattern, flags, replacement, description, enabled`,
      [name?.trim(), pattern, flags, replacement, description, enabled, id, req.token]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "rule_not_found" });
    }

    res.json({ rule: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: "rule_name_already_exists" });
    }
    throw e;
  }
});

app.delete("/api/anon-rules/:id", requireToken, async (req, res) => {
  const id = Number(req.params.id);
  await pool.query(
    `DELETE FROM anon_rules WHERE id=$1 AND token=$2`,
    [id, req.token]
  );
  res.json({ ok: true });
});

app.post("/api/chat", requireToken, async (req, res) => {
  const content = String(req.body?.content || "").trim();
  if (!content) return res.status(400).json({ error: "content_required" });

  try {
    const out = await handleChat(req.token, content);
    // Frontend expects {message, actions}
    res.json({ message: out.message, actions: out.actions || [] });
  } catch (e) {
    console.error("[chat] error", e);
    res.status(500).json({ error: "chat_failed" });
  }
});

const port = Number(process.env.PORT || 8080);
await migrate();
app.listen(port, () => console.log(`[api] listening on :${port}`));
