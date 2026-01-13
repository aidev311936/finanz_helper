import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { migrate } from "./migrate.js";
import { ensureToken, newToken } from "./session.js";
import { pool } from "./db.js";

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser(process.env.COOKIE_SECRET || "dev"));

function requireToken(req, res, next) {
  const token = req.cookies?.token || req.headers["x-token"];
  if (!token) return res.status(401).json({ error: "missing_token" });
  req.token = token;
  next();
}

app.post("/api/session", async (req, res) => {
  const token = newToken();
  await ensureToken(token);
  res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
  res.json({ token });
});

/** READ bank mappings (frontend uses for bank detection, no UI mapping) */
app.get("/api/bank-mappings", requireToken, async (req, res) => {
  const r = await pool.query(`SELECT bank_name, detection_hints, without_header, booking_date_parse_format
                              FROM bank_mapping ORDER BY bank_name ASC`);
  res.json({ data: r.rows });
});

/** Bank unknown -> user provides bank_name -> support ticket */
app.post("/api/bank-format-requests", requireToken, async (req, res) => {
  const bank_name = String(req.body?.bank_name || "").trim();
  if (!bank_name) return res.status(400).json({ error: "bank_name_required" });

  await pool.query(`INSERT INTO bank_format_requests(token, bank_name) VALUES ($1,$2)`, [req.token, bank_name]);
  res.json({ ok: true });
});

/** Accounts */
app.get("/api/accounts", requireToken, async (req, res) => {
  const bank_name = req.query.bank_name ? String(req.query.bank_name) : null;
  const r = bank_name
    ? await pool.query(`SELECT id, bank_name, alias, handle FROM accounts WHERE token=$1 AND bank_name=$2 ORDER BY id ASC`, [req.token, bank_name])
    : await pool.query(`SELECT id, bank_name, alias, handle FROM accounts WHERE token=$1 ORDER BY id ASC`, [req.token]);

  res.json({ data: r.rows });
});

async function nextAccountHandle(token) {
  const r = await pool.query(`SELECT COUNT(*)::int AS c FROM accounts WHERE token=$1`, [token]);
  const n = r.rows[0].c + 1;
  return `acc_${n}`;
}

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

/** Imports */
app.post("/api/imports", requireToken, async (req, res) => {
  const account_id = Number(req.body?.account_id);
  if (!account_id) return res.status(400).json({ error: "account_id_required" });

  const r = await pool.query(
    `INSERT INTO imports(token, account_id) VALUES($1,$2) RETURNING id`,
    [req.token, account_id]
  );

  res.json({ data: { import_id: r.rows[0].id } });
});

/** Transactions bulk insert (masked only) */
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
      // Minimal required fields (extend as needed)
      const booking_hash = String(t.booking_hash || "");
      const booking_date_iso = t.booking_date_iso || null;
      const booking_text = String(t.booking_text || "");
      const booking_type = t.booking_type ? String(t.booking_type) : null;
      const amount_value = t.booking_amount_value != null ? Number(t.booking_amount_value) : null;

      const r = await client.query(
        `INSERT INTO masked_transactions(
            token, account_id, import_id,
            bank_name, booking_date_iso, booking_text, booking_type,
            booking_amount_value, booking_hash
         )
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (account_id, booking_hash) DO NOTHING
         RETURNING id`,
        [req.token, account_id, import_id, t.bank_name || null, booking_date_iso, booking_text, booking_type, amount_value, booking_hash]
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
    throw e;
  } finally {
    client.release();
  }

  res.json({ data: { inserted, skipped_duplicates } });
});

/** Enqueue categorization job */
app.post("/api/categorization/run", requireToken, async (req, res) => {
  const import_id = Number(req.body?.import_id);
  if (!import_id) return res.status(400).json({ error: "import_id_required" });

  const r = await pool.query(
    `INSERT INTO jobs(token, type, payload)
     VALUES($1,'categorize_import', jsonb_build_object('import_id',$2))
     RETURNING id`,
    [req.token, import_id]
  );

  res.json({ data: { job_id: r.rows[0].id } });
});

/** Chat (very minimal skeleton) */
app.post("/api/chat", requireToken, async (req, res) => {
  const content = String(req.body?.content || "").trim();
  if (!content) return res.status(400).json({ error: "content_required" });

  await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'user',$2)`, [req.token, content]);

  // Phase1 skeleton: simple canned response + next action
  const answer = {
    message: "Alles klar. Welche Auswertung möchtest du sehen?",
    actions: [
      { type: "button", label: "Teuerstes Abo (Monat wählen)", value: "intent:most_expensive_subscription" },
      { type: "button", label: "Ausgaben an einem Tag", value: "intent:spend_by_day" }
    ]
  };

  await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [req.token, JSON.stringify(answer)]);

  res.json(answer);
});

const port = Number(process.env.PORT || 8080);

await migrate();
app.listen(port, () => console.log(`[api] listening on :${port}`));
