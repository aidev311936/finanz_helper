import { pool } from "../db.js";
import { LLM } from "../llm/provider.js";
import { TOOL_SPEC, runTool } from "./tools.js";

const llm = new LLM();

function uiButton(label, value) {
  return { type: "button", label, value };
}

function makeTable(rows) {
  // Minimal "table" action: frontend can render as markdown-ish or simple list later.
  return { type: "table", rows };
}

async function loadRecentChat(token, limit = 18) {
  const r = await pool.query(
    `SELECT role, content FROM chat_messages WHERE token=$1 ORDER BY created_on DESC LIMIT $2`,
    [token, limit]
  );
  return r.rows.reverse();
}

function normalizeUserMessage(text) {
  return String(text || "").trim();
}

const SYSTEM = `
Du bist ein empathischer, sehr einfacher KI-Haushaltmanager.

WICHTIG:
- Du hast Zugriff auf anonymisierte Umsätze über TOOLS.
- Wenn Informationen fehlen (z.B. Monat/Jahr), frage kurz nach und biete passende Buttons an.
- Gib Antworten immer als JSON im folgenden Format zurück (ohne Markdown):
  {
    "message": "...",
    "actions": [ ... optional ... ],
    "tool_call": {"name": "...", "args": {...}} | null
  }

UI-ACTIONS:
- button: {"type":"button","label":"...","value":"..."}
- date:   {"type":"date","label":"...","value":"YYYY-MM-DD"}
- text:   {"type":"text","label":"...","placeholder":"...","submitLabel":"OK"}
- table:  {"type":"table","rows":[{"col":"value"}, ...]}

TOOLS:
${JSON.stringify(TOOL_SPEC, null, 2)}

Regeln:
- Wenn du ein Tool brauchst, setze tool_call und schreibe in message kurz "Ich schaue kurz nach…".
- Nach einem Tool-Resultat: antworte mit message + ggf. actions und tool_call = null.
`;

export async function handleChat(token, userText) {
  const content = normalizeUserMessage(userText);
  if (!content) throw new Error("content_required");

  // Store user msg
  await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'user',$2)`, [token, content]);

  const history = await loadRecentChat(token, 18);

  // Planner step
  const plan = await llm.generateJson([
    { role: "system", content: SYSTEM },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content }
  ]);

  // If model returned a tool call, execute it and do a second pass to format the answer.
  if (plan?.tool_call?.name) {
    const toolResult = await runTool(token, plan.tool_call);

    const final = await llm.generateJson([
      { role: "system", content: SYSTEM },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content },
      { role: "assistant", content: JSON.stringify(plan) },
      {
        role: "system",
        content: `TOOL_RESULT for ${plan.tool_call.name}: ${JSON.stringify(toolResult)}`
      },
      {
        role: "user",
        content:
          "Formuliere jetzt die finale Antwort für den Nutzer. Antworte als JSON im Format {message, actions, tool_call:null}."
      }
    ]);

    const response = {
      message: String(final?.message || ""),
      actions: Array.isArray(final?.actions) ? final.actions : [],
      tool_call: null
    };

    await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
    return response;
  }

  // No tool call => direct answer
  const response = {
    message: String(plan?.message || ""),
    actions: Array.isArray(plan?.actions) ? plan.actions : [],
    tool_call: null
  };

  // If the plan message is empty, provide a friendly fallback.
  if (!response.message) {
    response.message = "Okay. Was möchtest du genau wissen?";
    response.actions = [uiButton("Teuerstes Abo (Monat)", "intent:most_expensive_subscription")];
  }

  await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
  return response;
}
