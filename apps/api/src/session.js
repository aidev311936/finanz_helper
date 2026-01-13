import crypto from "node:crypto";
import { pool } from "./db.js";

export async function ensureToken(token) {
  await pool.query(
    `INSERT INTO user_tokens(token) VALUES($1)
     ON CONFLICT (token) DO UPDATE SET accessed_on=now()`,
    [token]
  );
}

export function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}
