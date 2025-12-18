import fs from 'fs';
import { Pool } from 'pg';

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } });
  const sql = fs.readFileSync(new URL('./001_init.sql', import.meta.url), 'utf8');
  try {
    await pool.query(sql);
    console.log('Migration completed successfully');
  } catch (e) {
    console.error('Migration failed', e);
  } finally {
    await pool.end();
  }
}

migrate();