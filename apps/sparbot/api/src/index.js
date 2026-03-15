/**
 * Sparbot API — Express Server
 *
 * Endpoints:
 *   GET  /health         Health check
 *   POST /api/session    Create/resume session
 *   GET  /api/profile    Load user profile
 *   POST /api/profile    Create user profile (onboarding)
 *   GET  /api/messages   Load chat history
 *   POST /api/chat       Send message → LLM → response
 *   GET  /api/usage      Today's token usage
 *   GET  /api/llm-status LLM provider info
 */

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { migrate } from "./migrate.js";
import { ensureToken, newToken, touchToken } from "./session.js";
import { pool } from "./db.js";
import { chatCompletion, llmStatus } from "./llm.js";
import { getOrRefreshSummary, checkNewImports } from "./summary.js";

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser(process.env.COOKIE_SECRET || "dev"));

app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// ── Auth middleware ─────────────────────────────────────────

function requireToken(req, res, next) {
    const token = req.headers["x-token"] || req.cookies.token;
    if (!token) return res.status(401).json({ error: "token_required" });
    req.token = token;
    touchToken(token).catch(() => { });
    next();
}

// ── Session ─────────────────────────────────────────────────

app.post("/api/session", async (_req, res) => {
    const token = newToken();
    await ensureToken(token);
    res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
    res.json({ token });
});

// ── Profile ─────────────────────────────────────────────────

app.get("/api/profile", requireToken, async (req, res) => {
    const r = await pool.query(
        `SELECT display_name, formality, created_on FROM sparbot_profiles WHERE token = $1`,
        [req.token]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "no_profile" });
    res.json({ data: r.rows[0] });
});

app.post("/api/profile", requireToken, async (req, res) => {
    const displayName = String(req.body?.display_name || "").trim();
    const formality = req.body?.formality === "sie" ? "sie" : "du";
    if (!displayName) return res.status(400).json({ error: "display_name_required" });

    await pool.query(
        `INSERT INTO sparbot_profiles(token, display_name, formality)
     VALUES($1, $2, $3)
     ON CONFLICT (token)
     DO UPDATE SET display_name = EXCLUDED.display_name, formality = EXCLUDED.formality`,
        [req.token, displayName, formality]
    );
    res.json({ ok: true });
});

// ── Messages ────────────────────────────────────────────────

app.get("/api/messages", requireToken, async (req, res) => {
    const r = await pool.query(
        `SELECT id, role, content, selected_action, created_on
     FROM sparbot_messages WHERE token = $1
     ORDER BY created_on ASC`,
        [req.token]
    );
    res.json({ data: r.rows });
});

// ── Chat ────────────────────────────────────────────────────

const DAILY_REQUEST_LIMIT = parseInt(process.env.LLM_DAILY_REQUEST_LIMIT || "50", 10);
const DAILY_TOKEN_LIMIT = parseInt(process.env.LLM_DAILY_TOKEN_LIMIT || "100000", 10);
const HISTORY_WINDOW = 10;

app.post("/api/chat", requireToken, async (req, res) => {
    const userMessage = String(req.body?.message || "").trim();
    if (!userMessage) return res.status(400).json({ error: "message_required" });

    try {
        // 1. Check daily limits
        const exceeded = await checkLimits(req.token);
        if (exceeded) {
            const limitMsg = buildContentBlocks(
                "Du hast dein Tageslimit erreicht. Morgen stehe ich dir wieder zur Verfügung! 🌙"
            );
            const saved = await saveMessage(req.token, "assistant", limitMsg);
            return res.json({ data: saved });
        }

        // 2. Save user message
        const userContent = [{ type: "text", text: userMessage }];
        await saveMessage(req.token, "user", userContent);

        // 3. Load profile + summary
        const profile = await loadProfile(req.token);
        const summary = await getOrRefreshSummary(req.token);

        // 4. Load recent history
        const history = await loadHistory(req.token, HISTORY_WINDOW);

        // 5. Build system prompt
        const systemPrompt = buildSystemPrompt(profile, summary);

        // 6. Convert history to LLM messages
        const llmMessages = historyToLlmMessages(history);

        // 7. Call LLM
        const llmResult = await chatCompletion({
            systemPrompt,
            messages: llmMessages,
            maxTokens: 1024,
        });

        // 8. Parse response into content blocks
        const assistantContent = parseAssistantResponse(llmResult.content, profile);

        // 9. Save assistant message
        const saved = await saveMessage(req.token, "assistant", assistantContent);

        // 10. Track usage
        await trackUsage(req.token, llmResult.inputTokens, llmResult.outputTokens);

        res.json({ data: saved });
    } catch (err) {
        console.error("[chat] error:", err);
        res.status(500).json({ error: "chat_failed" });
    }
});

// ── Usage ───────────────────────────────────────────────────

app.get("/api/usage", requireToken, async (req, res) => {
    const r = await pool.query(
        `SELECT input_tokens, output_tokens, request_count
     FROM sparbot_usage WHERE token = $1 AND usage_date = CURRENT_DATE`,
        [req.token]
    );
    const usage = r.rows[0] || { input_tokens: 0, output_tokens: 0, request_count: 0 };
    res.json({
        data: {
            ...usage,
            limits: { daily_requests: DAILY_REQUEST_LIMIT, daily_tokens: DAILY_TOKEN_LIMIT },
        },
    });
});

// ── LLM Status ──────────────────────────────────────────────

app.get("/api/llm-status", (_req, res) => {
    res.json({ data: llmStatus() });
});

// ── New-data check ──────────────────────────────────────────

app.get("/api/new-imports", requireToken, async (req, res) => {
    const result = await checkNewImports(req.token);
    res.json({ data: result });
});

// ── Helpers ─────────────────────────────────────────────────

async function loadProfile(token) {
    const r = await pool.query(
        `SELECT display_name, formality FROM sparbot_profiles WHERE token = $1`,
        [token]
    );
    return r.rows[0] || { display_name: "User", formality: "du" };
}

async function loadHistory(token, limit) {
    const r = await pool.query(
        `SELECT role, content FROM sparbot_messages
     WHERE token = $1 ORDER BY created_on DESC LIMIT $2`,
        [token, limit]
    );
    return r.rows.reverse();
}

function historyToLlmMessages(history) {
    return history.map((msg) => {
        // Extract text blocks for LLM context
        const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];
        const text = blocks
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n");
        return { role: msg.role, content: text || "(action)" };
    });
}

async function saveMessage(token, role, content) {
    const r = await pool.query(
        `INSERT INTO sparbot_messages(token, role, content)
     VALUES($1, $2, $3)
     RETURNING id, role, content, created_on`,
        [token, role, JSON.stringify(content)]
    );
    return r.rows[0];
}

async function checkLimits(token) {
    const r = await pool.query(
        `SELECT request_count, input_tokens + output_tokens AS total_tokens
     FROM sparbot_usage WHERE token = $1 AND usage_date = CURRENT_DATE`,
        [token]
    );
    if (r.rowCount === 0) return false;
    const { request_count, total_tokens } = r.rows[0];
    return request_count >= DAILY_REQUEST_LIMIT || total_tokens >= DAILY_TOKEN_LIMIT;
}

async function trackUsage(token, inputTokens, outputTokens) {
    await pool.query(
        `INSERT INTO sparbot_usage(token, input_tokens, output_tokens, request_count)
     VALUES($1, $2, $3, 1)
     ON CONFLICT (token, usage_date)
     DO UPDATE SET
       input_tokens = sparbot_usage.input_tokens + EXCLUDED.input_tokens,
       output_tokens = sparbot_usage.output_tokens + EXCLUDED.output_tokens,
       request_count = sparbot_usage.request_count + 1`,
        [token, inputTokens, outputTokens]
    );
}

function buildSystemPrompt(profile, summary) {
    const anrede =
        profile.formality === "sie"
            ? `Sieze den User und spreche ihn mit "${profile.display_name}" an.`
            : `Duze den User und spreche ihn mit "${profile.display_name}" an.`;

    return `Du bist Sparbot, ein freundlicher KI-Finanzberater.
${anrede}
Deine Aufgabe: Hilf dem User, Sparmöglichkeiten in seinen Ausgaben zu finden.
Antworte kurz und prägnant. Nutze Emojis sparsam.

Hier ist eine Zusammenfassung der Finanzdaten des Users:
${JSON.stringify(summary, null, 2)}

Wenn du Umsätze als Tabelle anzeigen willst, beschreibe sie im Text.
Die API wird die tatsächlichen Daten aus der Datenbank einfügen.

Am Ende jeder Antwort kannst du 2-3 Folge-Fragen vorschlagen,
die der User als nächstes stellen könnte.
Formatiere diese als eigene Zeilen am Ende, jeweils mit ">> " Prefix.
Beispiel:
>> Zeig mir meine Abo-Kosten
>> Wo kann ich am meisten sparen?`;
}

function buildContentBlocks(text) {
    return [{ type: "text", text }];
}

/**
 * Parse LLM response text into content blocks.
 * Extracts suggested actions from lines starting with ">> ".
 */
function parseAssistantResponse(text) {
    const lines = text.split("\n");
    const textLines = [];
    const buttons = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith(">> ")) {
            buttons.push({
                label: trimmed.slice(3).trim(),
                value: trimmed.slice(3).trim(),
            });
        } else {
            textLines.push(line);
        }
    }

    // Remove trailing empty lines from text
    while (textLines.length > 0 && textLines[textLines.length - 1].trim() === "") {
        textLines.pop();
    }

    const blocks = [{ type: "text", text: textLines.join("\n") }];

    if (buttons.length > 0) {
        blocks.push({ type: "actions", buttons });
    }

    return blocks;
}

// ── Start ───────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "8081", 10);

migrate()
    .then(() => {
        app.listen(PORT, () => console.log(`[sparbot-api] listening on :${PORT}`));
    })
    .catch((err) => {
        console.error("[sparbot-api] migration failed:", err);
        process.exit(1);
    });
