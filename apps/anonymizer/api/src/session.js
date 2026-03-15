import crypto from "node:crypto";
import { pool } from "./db.js";

export function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export async function ensureToken(token) {
  await pool.query(
    `INSERT INTO user_tokens(token) VALUES($1)
     ON CONFLICT (token) DO UPDATE SET accessed_on=now()`,
    [token]
  );
}

export async function touchToken(token) {
  await pool.query(`UPDATE user_tokens SET accessed_on=now() WHERE token=$1`, [token]);
}
