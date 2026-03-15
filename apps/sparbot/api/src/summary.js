/**
 * Transaction Summary Generator
 *
 * Aggregates anonymised transactions from masked_transactions into a compact
 * JSON summary suitable for LLM context (~500 tokens instead of ~50k).
 */

import { pool } from "./db.js";

/**
 * Build a spending summary for the given user token.
 * Groups by booking_text, computes totals, and identifies notable patterns.
 *
 * @param {string} token
 * @returns {Promise<object>} summary JSON
 */
export async function buildTransactionSummary(token) {
    // 1. Fetch accounts
    const accountsRes = await pool.query(
        `SELECT id, bank_name, alias FROM accounts WHERE token = $1 ORDER BY id`,
        [token]
    );
    const konten = accountsRes.rows.map((a) => ({
        id: a.id,
        alias: a.alias,
        bank: a.bank_name,
    }));

    // 2. Aggregate transactions
    const aggRes = await pool.query(
        `SELECT
       booking_text,
       COUNT(*)::int                     AS anzahl,
       SUM(booking_amount_value)         AS summe,
       MIN(booking_date_iso)             AS first_date,
       MAX(booking_date_iso)             AS last_date,
       account_id
     FROM masked_transactions
     WHERE token = $1 AND booking_amount_value IS NOT NULL
     GROUP BY booking_text, account_id
     ORDER BY summe ASC`,
        [token]
    );

    // 3. Separate income vs expenses
    let totalAusgaben = 0;
    let totalEinnahmen = 0;
    const kategorien = {};

    for (const row of aggRes.rows) {
        const s = parseFloat(row.summe);
        if (s < 0) {
            totalAusgaben += Math.abs(s);
            const key = row.booking_text || "Unbekannt";
            if (!kategorien[key]) {
                kategorien[key] = { summe: 0, anzahl: 0, konten: [] };
            }
            kategorien[key].summe += Math.abs(s);
            kategorien[key].anzahl += row.anzahl;
            const konto = konten.find((k) => k.id === Number(row.account_id));
            if (konto && !kategorien[key].konten.includes(konto.alias)) {
                kategorien[key].konten.push(konto.alias);
            }
        } else {
            totalEinnahmen += s;
        }
    }

    // 4. Determine time range
    const rangeRes = await pool.query(
        `SELECT MIN(booking_date_iso) AS first, MAX(booking_date_iso) AS last
     FROM masked_transactions WHERE token = $1`,
        [token]
    );
    const range = rangeRes.rows[0] || {};

    // 5. Sort categories by amount (largest first), take top 20
    const sortedKategorien = Object.entries(kategorien)
        .sort(([, a], [, b]) => b.summe - a.summe)
        .slice(0, 20)
        .reduce((acc, [k, v]) => {
            acc[k] = { summe: Math.round(v.summe * 100) / 100, anzahl: v.anzahl, konten: v.konten };
            return acc;
        }, {});

    return {
        zeitraum: {
            von: range.first ? new Date(range.first).toISOString().slice(0, 10) : null,
            bis: range.last ? new Date(range.last).toISOString().slice(0, 10) : null,
        },
        konten: konten.map(({ alias, bank }) => ({ alias, bank })),
        total_ausgaben: Math.round(totalAusgaben * 100) / 100,
        total_einnahmen: Math.round(totalEinnahmen * 100) / 100,
        kategorien: sortedKategorien,
    };
}

/**
 * Get or refresh the cached summary for a user.
 * Rebuilds if no summary exists or new imports arrived since last build.
 *
 * @param {string} token
 * @returns {Promise<object>} summary JSON
 */
export async function getOrRefreshSummary(token) {
    const profileRes = await pool.query(
        `SELECT transaction_summary, summary_updated_on FROM sparbot_profiles WHERE token = $1`,
        [token]
    );
    const profile = profileRes.rows[0];

    // Check for new imports since last summary
    let hasNewData = true;
    if (profile?.summary_updated_on) {
        const newImports = await pool.query(
            `SELECT COUNT(*)::int AS cnt FROM imports WHERE token = $1 AND created_on > $2`,
            [token, profile.summary_updated_on]
        );
        hasNewData = newImports.rows[0].cnt > 0;
    }

    if (profile?.transaction_summary && !hasNewData) {
        return profile.transaction_summary;
    }

    // Rebuild
    const summary = await buildTransactionSummary(token);
    await pool.query(
        `UPDATE sparbot_profiles
     SET transaction_summary = $2, summary_updated_on = now()
     WHERE token = $1`,
        [token, JSON.stringify(summary)]
    );
    return summary;
}

/**
 * Check whether new imports exist since the last summary update.
 *
 * @param {string} token
 * @returns {Promise<{ hasNew: boolean, count: number }>}
 */
export async function checkNewImports(token) {
    const profileRes = await pool.query(
        `SELECT summary_updated_on FROM sparbot_profiles WHERE token = $1`,
        [token]
    );
    const updatedOn = profileRes.rows[0]?.summary_updated_on;
    if (!updatedOn) return { hasNew: false, count: 0 };

    const res = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM imports WHERE token = $1 AND created_on > $2`,
        [token, updatedOn]
    );
    return { hasNew: res.rows[0].cnt > 0, count: res.rows[0].cnt };
}
