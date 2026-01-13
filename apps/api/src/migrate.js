import fs from "node:fs";
import path from "node:path";
import { pool } from "./db.js";

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations(
      id TEXT PRIMARY KEY,
      applied_on TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function isApplied(id) {
  const r = await pool.query(`SELECT 1 FROM _migrations WHERE id=$1`, [id]);
  return r.rowCount > 0;
}

async function markApplied(id) {
  await pool.query(`INSERT INTO _migrations(id) VALUES ($1)`, [id]);
}

export async function migrate() {
  await ensureMigrationsTable();

  const dir = path.resolve("migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    if (await isApplied(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await pool.query(sql);
    await markApplied(f);
    console.log(`[migrate] applied ${f}`);
  }
}
