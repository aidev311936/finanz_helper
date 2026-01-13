import { pool } from "../db.js";
import { LLM } from "../llm/provider.js";
import {
  TOOL_SPEC,
  runTool,
  listAvailableMonths,
  spendingSummaryMonth,
  budgetSuggestionsMonth,
  setBudget,
  budgetStatusMonth,
  subscriptionSummaryMonth,
  cancellationCandidatesMonth,
  transactionById,
  spendingByDay
} from "./tools.js";

const llm = new LLM();

function uiButton(label, value) {
  return { type: "button", label, value };
}

function makeTable(rows) {
  // Minimal "table" action: frontend can render as markdown-ish or simple list later.
  return { type: "table", rows };
}

function monthButtons(months, prefix) {
  return months.slice(0, 6).map((ym) => uiButton(ym, `${prefix}${ym}`));
}

function parseCommand(text) {
  const t = String(text || "").trim();
  if (t === "intent:budget_wizard") return { type: "budget_wizard" };
  if (t.startsWith("BUDGET_MONTH|")) return { type: "budget_month", month: t.split("|")[1] };
  if (t.startsWith("BUDGET_SET|")) {
    const parts = t.split("|");
    return { type: "budget_set", category: parts[1], limit: parts[2], month: parts[3] };
  }
  if (t.startsWith("BUDGET_STATUS|")) return { type: "budget_status", month: t.split("|")[1] };

  if (t === "intent:subscriptions_overview") return { type: "subs_wizard" };
  if (t.startsWith("SUB_MONTH|")) return { type: "subs_month", month: t.split("|")[1] };

  if (t === "intent:month_summary") return { type: "month_summary" };
  if (t.startsWith("MONTH|")) return { type: "month_summary_month", month: t.split("|")[1] };

  if (t.startsWith("TX|")) return { type: "tx", id: t.split("|")[1] };
  if (t.startsWith("DAY|")) return { type: "day", date: t.split("|")[1] };
  return null;
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
- Nutze für typische Fragen die passenden Tools:
  - Monatsübersicht: spendingSummaryMonth
  - Top Händler: topMerchantsMonth
  - Abos/Recurring: listSubscriptionsMonth oder mostExpensiveSubscription
  - Abo-Zusammenfassung: subscriptionSummaryMonth
  - Kündigungs-Kandidaten: cancellationCandidatesMonth
  - Doppelte Abos: duplicateSubscriptionsMonth
  - Fixkosten vs variabel: fixedVsVariableMonth
  - Sparpotenziale: savingsIdeasMonth
  - Budgets anzeigen: listBudgets oder budgetStatusMonth
  - Budget-Vorschläge: budgetSuggestionsMonth
  - Budget setzen: setBudget
  - Warnungen/Alerts: alertsMonth

Antworte immer als JSON (ohne Markdown):
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
- Wenn der Nutzer ein Budget setzen will, frage nach Kategorie und Monatsbetrag (oder biete Vorschläge aus den Top-Kategorien der Monatsübersicht an).
`;

export async function handleChat(token, userText) {
  const content = normalizeUserMessage(userText);
  if (!content) throw new Error("content_required");

  // Store user msg
  await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'user',$2)`, [token, content]);

  // Deterministic mini-wizards for better UX (budgets/subscriptions/summary)
  const cmd = parseCommand(content);
  if (cmd) {
    const months = await listAvailableMonths(token);

    // No data yet
    if ((cmd.type === "budget_wizard" || cmd.type === "subs_wizard" || cmd.type === "month_summary") && months.length === 0) {
      const response = {
        message: "Ich habe noch keine Umsätze von dir. Bitte lade zuerst eine CSV hoch – dann kann ich Budgets und Abos analysieren.",
        actions: []
      };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }

    if (cmd.type === "budget_wizard") {
      const response = {
        message: "Für welchen Monat soll ich dir Budget‑Vorschläge machen?",
        actions: monthButtons(months, "BUDGET_MONTH|")
      };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }

    if (cmd.type === "budget_month") {
      const ym = String(cmd.month || "").trim();
      const sug = await budgetSuggestionsMonth(token, ym);

      const rows = sug.suggestions.map((s) => ({
        Kategorie: s.category,
        "Letzter Monat (€)": s.spent,
        "Vorschlag (€)": s.suggested_limit,
        "Aktuelles Budget (€)": s.existing_limit ?? "–"
      }));

      const actions = sug.suggestions
        .slice(0, 6)
        .map((s) => uiButton(`Budget setzen: ${s.category} = ${s.suggested_limit}€`, `BUDGET_SET|${s.category}|${s.suggested_limit}|${ym}`));

      actions.push(uiButton("Budget‑Status anzeigen", `BUDGET_STATUS|${ym}`));

      const response = {
        message:
          `Hier sind Vorschläge basierend auf deinen Ausgaben in ${ym}.\n\nTipp: Setze zuerst 1–3 Budgets für die größten Kategorien – das bringt sofort Kontrolle.`,
        actions: [makeTable(rows), ...actions]
      };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }

    if (cmd.type === "budget_set") {
      const ym = String(cmd.month || months[0] || "");
      const category = String(cmd.category || "");
      const limit = Number(cmd.limit);
      const r = await setBudget(token, category, limit);
      const status = await budgetStatusMonth(token, ym);
      const row = status.budgets.find((b) => b.category === r.category);

      const response = {
        message: row
          ? `✅ Budget gesetzt: **${r.category}** = ${r.monthly_limit}€ pro Monat.\nIn ${ym} hast du bisher ${row.spent}€ ausgegeben (${row.remaining}€ übrig).`
          : `✅ Budget gesetzt: **${r.category}** = ${r.monthly_limit}€ pro Monat.`,
        actions: [uiButton("Weitere Budget‑Vorschläge", "intent:budget_wizard"), uiButton("Warnungen (Monat)", `intent:alerts ${ym}`)]
      };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }

    if (cmd.type === "budget_status") {
      const ym = String(cmd.month || months[0] || "");
      const status = await budgetStatusMonth(token, ym);
      const rows = status.budgets.map((b) => ({
        Kategorie: b.category,
        "Limit (€)": b.limit,
        "Ausgegeben (€)": b.spent,
        "Übrig (€)": b.remaining,
        Status: b.status
      }));
      const response = {
        message: `Budget‑Status für ${ym}:`,
        actions: [makeTable(rows), uiButton("Weitere Budgets setzen", "intent:budget_wizard")]
      };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }

    if (cmd.type === "subs_wizard") {
      const response = {
        message: "Für welchen Monat soll ich deine Abos zusammenfassen und Kündigungs‑Kandidaten zeigen?",
        actions: monthButtons(months, "SUB_MONTH|")
      };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }

    if (cmd.type === "subs_month") {
      const ym = String(cmd.month || "").trim();
      const summary = await subscriptionSummaryMonth(token, ym);
      const canc = await cancellationCandidatesMonth(token, ym);

      const bucketRows = summary.buckets.map((b) => ({ Bucket: b.bucket, "Summe (€)": b.total, Anzahl: b.count }));
      const topItems = summary.items.slice(0, 12).map((it) => ({
        ID: it.id,
        Merchant: it.merchant,
        "Betrag (€)": Number((it.amount || 0).toFixed(2)),
        Periode: it.period,
        Bucket: it.bucket
      }));

      const cancelRows = [
        ...canc.duplicate_groups.map((d) => ({ Typ: "Doppelt", Kategorie: d.category, "Summe (€)": d.total, Merchants: d.merchants.map((m) => m.merchant).join(", ") })),
        ...canc.expensive_candidates.map((e) => ({ Typ: "Teuer", Bucket: e.bucket, Merchant: e.merchant, "Betrag (€)": e.amount, Periode: e.period }))
      ].slice(0, 14);

      const response = {
        message:
          `Abo‑Zusammenfassung für ${ym}: geschätzt **${summary.estimated_monthly_total}€ / Monat**.\n\nWenn du 1–2 Streaming/Musik/Gaming‑Dienste kündigst, merkst du es sofort.`,
        actions: [
          makeTable(bucketRows),
          makeTable(topItems),
          cancelRows.length ? makeTable(cancelRows) : null,
          { type: "text", label: "Transaktions-ID", placeholder: "TX|123", submitLabel: "Details" },
          uiButton("Noch einen Monat", "intent:subscriptions_overview")
        ].filter(Boolean)
      };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }

    if (cmd.type === "month_summary") {
      const response = {
        message: "Für welchen Monat soll ich dir eine Übersicht zeigen?",
        actions: monthButtons(months, "MONTH|")
      };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }

    if (cmd.type === "month_summary_month") {
      const ym = String(cmd.month || "").trim();
      const sum = await spendingSummaryMonth(token, ym);
      const catRows = sum.by_category.slice(0, 12).map((c) => ({ Kategorie: c.category, "Summe (€)": c.total, Anzahl: c.count }));
      const accRows = sum.by_account.map((a) => ({ Bank: a.bank, Konto: a.alias, "Summe (€)": a.total, Anzahl: a.count }));
      const response = {
        message: `Monatsübersicht ${ym}: **${sum.total}€** in ${sum.count} Buchungen.`,
        actions: [makeTable(catRows), makeTable(accRows), uiButton("Budgets vorschlagen", "intent:budget_wizard"), uiButton("Abos prüfen", "intent:subscriptions_overview")]
      };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }

    if (cmd.type === "tx") {
      const id = Number(cmd.id);
      if (!Number.isFinite(id) || id <= 0) {
        const response = { message: "Bitte gib eine Transaktions‑ID an (z.B. TX|123).", actions: [] };
        await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
        return response;
      }
      const t = await transactionById(token, id);
      const response = t
        ? {
            message: `Transaktion #${id}:\nBank: ${t.bank_name}\nKonto: ${t.account_alias}\nDatum: ${new Date(t.booking_date_iso).toISOString().slice(0, 10)}\nBetrag: ${t.booking_amount_value}€\nText: ${t.booking_text}\nKategorie: ${t.booking_category || '—'}`,
            actions: []
          }
        : { message: `Ich finde keine Transaktion mit ID ${id}.`, actions: [] };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }

    if (cmd.type === "day") {
      const date = String(cmd.date || "").trim();
      const out = await spendingByDay(token, date);
      const rows = out.rows.slice(0, 40).map((r) => ({
        ID: r.id,
        Bank: r.bank_name,
        Konto: r.account_alias,
        Betrag: r.booking_amount_value,
        Text: r.booking_text,
        Art: r.booking_type,
        Kategorie: r.booking_category || ""
      }));
      const response = {
        message: `Am ${date} hast du ${out.total}€ ausgegeben.`,
        actions: [makeTable(rows)]
      };
      await pool.query(`INSERT INTO chat_messages(token, role, content) VALUES($1,'assistant',$2)`, [token, JSON.stringify(response)]);
      return response;
    }
  }

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
