import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import crypto from 'crypto';
import pkg from 'pg';

const { Pool } = pkg;

// Environment
const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.DATABASE_URL || '';

// Initialize DB connection pool
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } })
  : null;

// Express configuration
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// File upload
const upload = multer({ storage: multer.memoryStorage() });

// Helper: query the DB if configured
async function dbQuery(sql, params) {
  if (!pool) {
    throw new Error('Database not configured (DATABASE_URL missing)');
  }
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    client.release();
  }
}

// Create a new random token and insert into user_tokens
async function createToken() {
  const token = crypto.randomBytes(16).toString('hex');
  await dbQuery(
    'INSERT INTO user_tokens (token, settings) VALUES ($1, $2) ON CONFLICT (token) DO NOTHING',
    [token, JSON.stringify({})]
  );
  return token;
}

// Create a new workspace (id is a random string)
async function createWorkspace() {
  const id = 'ws_' + crypto.randomBytes(8).toString('hex');
  await dbQuery('INSERT INTO workspaces (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
  return id;
}

// Create import batch entry
async function createImportBatch(workspaceId, token, bankName, accountAlias, sourceFilename, rowCount) {
  const res = await dbQuery(
    `INSERT INTO import_batches (workspace_id, token, bank_name, account_alias, source_filename, row_count, started_on, finished_on) 
     VALUES ($1,$2,$3,$4,$5,$6, now(), now()) RETURNING id`,
    [workspaceId, token, bankName, accountAlias, sourceFilename, rowCount]
  );
  return res.rows[0].id;
}

// Load all bank mappings
async function loadBankMappings() {
  const { rows } = await dbQuery('SELECT * FROM bank_mapping', []);
  return rows;
}

// Detect bank mapping based on CSV headers
function detectBankMapping(headers, mappings) {
  let best = null;
  let bestScore = -1;
  for (const map of mappings) {
    let score = 0;
    const fields = [];
    // Score based on presence of booking_date header
    if (map.booking_date && Array.isArray(map.booking_date)) {
      for (const h of map.booking_date) {
        if (headers.includes(h)) score += 1;
      }
    }
    if (map.amount) {
      for (const h of map.amount) {
        if (headers.includes(h)) score += 1;
      }
    }
    if (map.booking_text) {
      for (const h of map.booking_text) {
        if (headers.includes(h)) score += 1;
      }
    }
    if (map.booking_type) {
      for (const h of map.booking_type) {
        if (headers.includes(h)) score += 1;
      }
    }
    // Additional hint: detection_hints.header_signature
    if (map.detection_hints && map.detection_hints.header_signature) {
      const signature = map.detection_hints.header_signature;
      let matched = 0;
      for (const sig of signature) {
        if (headers.map((h) => h.toLowerCase()).includes(sig.toLowerCase())) {
          matched += 1;
        }
      }
      score += matched * 2; // boost signature matches
    }
    if (score > bestScore) {
      bestScore = score;
      best = map;
    }
  }
  return best;
}

// Parse CSV buffer into records using mapping
function parseCsv(buffer, mapping) {
  // Determine delimiter: if semicolon appears more than commas, use semicolon
  const sample = buffer.toString('utf8', 0, Math.min(1024, buffer.length));
  const commaCount = (sample.match(/,/g) || []).length;
  const semicolonCount = (sample.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';
  // Parse
  const records = parse(buffer.toString('utf8'), {
    delimiter,
    columns: true,
    skip_empty_lines: true,
  });
  return records;
}

// Convert a date string to ISO (YYYY-MM-DD) based on mapping.parse_format or heuristics
function parseDate(value, parseFormat) {
  if (!value) return null;
  // Remove whitespace
  const trimmed = value.trim();
  // If parse format is provided, attempt manual parse
  if (parseFormat) {
    const fmt = parseFormat.toUpperCase();
    if (fmt === 'DD.MM.YYYY' && /^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) {
      const [d, m, y] = trimmed.split('.');
      return new Date(`${y}-${m}-${d}T00:00:00Z`).toISOString();
    }
    if (fmt === 'YYYY-MM-DD' && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(`${trimmed}T00:00:00Z`).toISOString();
    }
    // Add other formats as needed
  }
  // Try built-in Date parser
  const date = new Date(trimmed);
  if (!isNaN(date)) {
    return date.toISOString();
  }
  return null;
}

// Normalize amount: convert German format to dot decimal and return as string
function normalizeAmount(value) {
  if (typeof value !== 'string') return value;
  let v = value.trim();
  // Replace thousand separators and use dot for decimal
  // If comma appears after dot, treat comma as decimal; else treat comma as thousands
  if (v.includes(',') && v.lastIndexOf(',') > v.lastIndexOf('.')) {
    v = v.replace(/\./g, '').replace(',', '.');
  } else if (v.includes('.')) {
    v = v.replace(/,/g, '').replace(/\./g, '.');
  } else if (v.includes(',')) {
    v = v.replace(/\./g, '').replace(',', '.');
  }
  return v;
}

// Generate merchant_key by normalising text
function createMerchantKey(text) {
  if (!text) return null;
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return cleaned.slice(0, 64);
}

// Anonymize booking_text based on rules
function anonymizeText(text, rules) {
  let result = text;
  for (const rule of rules) {
    if (!rule || !rule.pattern || !rule.replacement) continue;
    if (rule.type === 'regex') {
      const regex = new RegExp(rule.pattern, 'gi');
      result = result.replace(regex, rule.replacement);
    } else if (rule.type === 'mask') {
      const regex = new RegExp(rule.pattern, 'gi');
      result = result.replace(regex, (match) => {
        if (rule.strategy === 'full') {
          return '*'.repeat(match.length);
        } else if (rule.strategy === 'keepFirstLast') {
          if (match.length <= 2) return '*'.repeat(match.length);
          return match[0] + '*'.repeat(match.length - 2) + match[match.length - 1];
        } else if (rule.strategy === 'partialPercent') {
          const percent = Number(rule.percent) || 0.5;
          const keep = Math.max(1, Math.floor(match.length * percent));
          return match.slice(0, keep) + '*'.repeat(match.length - keep);
        }
        return match;
      });
    }
  }
  return result;
}

// Load anonymization rules from user settings or fallback defaults
async function loadAnonymizationRules(token) {
  // Attempt to fetch rules from settings
  const res = await dbQuery('SELECT settings FROM user_tokens WHERE token=$1', [token]);
  let rules = [];
  if (res.rows.length > 0) {
    const settings = res.rows[0].settings || {};
    if (settings.anonymization_rules_v1 && Array.isArray(settings.anonymization_rules_v1)) {
      rules = settings.anonymization_rules_v1;
    }
  }
  // Default: mask IBAN and digits
  if (rules.length === 0) {
    rules = [
      {
        type: 'regex',
        pattern: '([A-Z]{2}[0-9]{2}[ ]?[0-9]{4}[ ]?[0-9]{4}[ ]?[0-9]{4}[ ]?[0-9]{4}(?:[ ]?[0-9]{0,2})?)',
        replacement: 'IBAN_MASK'
      },
      {
        type: 'regex',
        pattern: '\\d{3,}',
        replacement: 'XXX'
      }
    ];
  }
  return rules;
}

// Compute deterministic booking hash over important fields
function computeBookingHash(data) {
  const str = JSON.stringify(data);
  return crypto.createHash('sha256').update(str).digest('hex');
}

// API: Generate and return new token
app.post('/api/auth/token', async (req, res) => {
  try {
    const token = await createToken();
    res.json({ token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Token creation failed' });
  }
});

/**
 * POST /api/import/csv
 *
 * Handles uploading and processing of a CSV file. Detects the bank mapping,
 * parses the CSV according to the mapping, anonymizes sensitive fields,
 * computes booking_hash and merchant_key, and stores the transactions in the DB.
 * Returns the newly created token and workspace_id along with basic stats.
 */
app.post('/api/import/csv', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required (field name: file)' });
  }
  try {
    // Create token and workspace for this import
    const token = await createToken();
    const workspaceId = await createWorkspace();
    // Optional account alias provided by the user (e.g. "Girokonto" oder "Sparkonto")
    // multer.single('file') populates req.body with additional fields
    const accountAlias = req.body && typeof req.body.account_alias === 'string' && req.body.account_alias.trim().length > 0
      ? req.body.account_alias.trim()
      : null;

    // Load bank mappings
    const mappings = await loadBankMappings();
    if (mappings.length === 0) {
      throw new Error('No bank mappings available. Populate bank_mapping table.');
    }

    // Parse CSV to get header row (use csv-parse to parse into records)
    const allRecords = parseCsv(req.file.buffer, {});
    if (allRecords.length === 0) {
      return res.status(400).json({ error: 'CSV file contains no data' });
    }
    // Determine headers from first record keys
    const headers = Object.keys(allRecords[0]);
    const mapping = detectBankMapping(headers, mappings);
    if (!mapping) {
      throw new Error('Could not detect bank mapping');
    }

    // Load anonymization rules
    const rules = await loadAnonymizationRules(token);

    // Process each row
    const transactions = [];
    for (const row of allRecords) {
      // Extract fields based on mapping arrays (take first matching header)
      const getField = (arr) => {
        if (!arr) return '';
        for (const key of arr) {
          if (row[key] !== undefined) return row[key];
        }
        return '';
      };
      const bookingDateRaw = getField(mapping.booking_date);
      const bookingDateIso = parseDate(bookingDateRaw, mapping.booking_date_parse_format);
      const bookingText = getField(mapping.booking_text);
      const bookingType = getField(mapping.booking_type);
      const bookingAmountRaw = getField(mapping.amount);
      const bookingAmount = normalizeAmount(bookingAmountRaw);
      // booking_account is not defined in bank_mapping; instead use the provided account alias
      const bookingAccount = accountAlias || '';
      // Anonymize text
      const anonText = anonymizeText(bookingText, rules);
      // Merchant key
      const merchantKey = createMerchantKey(anonText);
      // Determine is_income: treat positive amounts as income
      let amountNum = parseFloat(bookingAmount.replace(/,/g, '.'));
      if (isNaN(amountNum)) amountNum = 0;
      const isIncome = amountNum > 0;
      // Compute booking hash
      const hash = computeBookingHash({ booking_date_raw: bookingDateRaw, booking_text: anonText, booking_type: bookingType, booking_amount: bookingAmount, booking_account });
      transactions.push({
        token,
        workspace_id: workspaceId,
        bank_name: mapping.bank_name,
        booking_date: bookingDateRaw,
        booking_date_raw: bookingDateRaw,
        booking_date_iso: bookingDateIso,
        booking_text: anonText,
        booking_type: bookingType,
        booking_amount: bookingAmount,
        booking_account: bookingAccount,
        booking_hash: hash,
        booking_category: null,
        account_alias: accountAlias,
        merchant_key: merchantKey,
        is_income: isIncome,
        currency: null,
      });
    }
    // Create import batch record (store account alias if provided)
    const importBatchId = await createImportBatch(workspaceId, token, mapping.bank_name, accountAlias, req.file.originalname, transactions.length);
    // Insert transactions
    const insertValues = [];
    const placeholders = [];
    let index = 1;
    for (const t of transactions) {
      // Build parameter placeholders for 17 columns
      const placeholder = [];
      for (let i = 0; i < 17; i++) {
        placeholder.push(`$${index++}`);
      }
      placeholders.push(`(${placeholder.join(', ')})`);
      insertValues.push(
        t.token,
        t.bank_name,
        t.booking_date,
        t.booking_date_raw,
        t.booking_date_iso,
        t.booking_text,
        t.booking_type,
        t.booking_amount,
        t.booking_account,
        t.booking_hash,
        t.booking_category,
        workspaceId,
        importBatchId,
        t.account_alias,
        t.merchant_key,
        t.is_income,
        t.currency
      );
    }
    const insertSql = `INSERT INTO masked_transactions (token, bank_name, booking_date, booking_date_raw, booking_date_iso, booking_text, booking_type, booking_amount, booking_account, booking_hash, booking_category, workspace_id, import_batch_id, account_alias, merchant_key, is_income, currency) VALUES ${placeholders.join(', ')}`;
    await dbQuery(insertSql, insertValues);
    res.json({ token, workspace_id: workspaceId, import_batch_id: importBatchId, count: transactions.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Import failed' });
  }
});

/**
 * GET /api/analysis/summary
 *
 * Returns aggregated sums for income, expenses and net for a given token or workspace_id.
 * Query parameters:
 *   token: filter by user token
 *   workspace_id: optional; if provided will override token
 */
app.get('/api/analysis/summary', async (req, res) => {
  try {
    const { token, workspace_id } = req.query;
    if (!token && !workspace_id) {
      return res.status(400).json({ error: 'token or workspace_id is required' });
    }
    const params = [];
    let where = '';
    if (workspace_id) {
      where = 'WHERE workspace_id = $1';
      params.push(workspace_id);
    } else if (token) {
      where = 'WHERE token = $1';
      params.push(token);
    }
    const summarySql = `SELECT 
        COUNT(*) AS count,
        COALESCE(SUM(CASE WHEN NULLIF(booking_amount, '')::numeric > 0 THEN NULLIF(booking_amount, '')::numeric ELSE 0 END),0) AS income_sum,
        COALESCE(SUM(CASE WHEN NULLIF(booking_amount, '')::numeric < 0 THEN NULLIF(booking_amount, '')::numeric ELSE 0 END),0) AS expense_sum
      FROM masked_transactions ${where}`;
    const { rows } = await dbQuery(summarySql, params);
    const result = rows[0] || { count: 0, income_sum: 0, expense_sum: 0 };
    const income = Number(result.income_sum) || 0;
    const expenses = Number(result.expense_sum) || 0;
    const net = income + expenses;
    res.json({ transaction_count: Number(result.count), income_sum: income, expense_sum: expenses, net });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Analysis failed' });
  }
});

/**
 * POST /api/transactions/:id/category
 *
 * Updates the booking_category for a transaction. Optionally applies to similar transactions based on merchant_key.
 */
app.post('/api/transactions/:id/category', async (req, res) => {
  try {
    const id = req.params.id;
    const { category, apply_to_similar } = req.body;
    if (!category) {
      return res.status(400).json({ error: 'category is required' });
    }
    // Fetch the transaction
    const { rows } = await dbQuery('SELECT merchant_key, token FROM masked_transactions WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'transaction not found' });
    }
    const { merchant_key, token } = rows[0];
    if (apply_to_similar && merchant_key) {
      // Update all transactions with same merchant_key and token
      await dbQuery('UPDATE masked_transactions SET booking_category = $1 WHERE merchant_key = $2 AND token = $3', [category, merchant_key, token]);
      return res.json({ updated_all: true, category });
    } else {
      await dbQuery('UPDATE masked_transactions SET booking_category = $1 WHERE id = $2', [category, id]);
      return res.json({ updated: true, category });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Update category failed' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
