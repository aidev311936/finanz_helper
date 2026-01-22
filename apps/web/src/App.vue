<template>
  <main class="shell">
    <header class="top">
      <div class="brand">Haushaltmanager</div>
      <div class="sub">Minimiere Ausgaben – ohne Tabellen-Chaos.</div>
    </header>

    <section class="chat">
      <div v-for="(m, idx) in messages" :key="idx" class="bubble" :class="m.role">
        <div class="text">{{ m.text }}</div>
        <ActionRenderer
          v-if="m.actions && m.actions.length"
          :actions="m.actions"
          @action="onAction"
          @file="onFile"
        />
      </div>
    </section>

    <footer class="composer">
      <input
        class="input"
        v-model="composer"
        :disabled="busy"
        placeholder="Schreib mir z.B. 'Zeig mir alle Abos'..."
        @keydown.enter.prevent="sendChat"
      />
      <button class="send" :disabled="busy || !composer.trim()" @click="sendChat">Senden</button>
    </footer>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import ActionRenderer from "./components/ActionRenderer.vue";
import type { Action, ChatMessage } from "./types";
import { ensureSession, fetchBankMappings, requestBankSupport, createAccount, createImport, uploadMaskedTransactions, sendChat as apiSendChat, fetchAnonRules, createAnonRule } from "./api";
import type { BankMapping } from "./lib/types";
import { buildMaskedTransactions, detectBankAndPrepare, buildOriginalTransactions } from "./lib/importPipeline";
import { applyAnonymization } from "./lib/anonymize";

const messages = ref<ChatMessage[]>([]);
const composer = ref("");
const busy = ref(false);

const mappings = ref<BankMapping[]>([]);
const pending = ref<null | {
  mapping: BankMapping;
  header: string[];
  dataRows: string[][];
}>(null);

// Anonymization rule state
const userRules = ref<any[]>([]);
const ruleToggles = ref<Set<number>>(new Set());
const ruleCreationState = ref<'idle' | 'awaiting_example' | 'awaiting_replacement' | 'awaiting_name'>('idle');
const ruleCreationDraft = ref<any>({});
const pendingAlias = ref<string>('');
const pendingPreview = ref<{ original: any[]; anonymized: any[] } | null>(null);

function pushAssistant(text: string, actions: Action[] = []) {
  messages.value.push({ role: "assistant", text, actions });
}
function pushUser(text: string) {
  messages.value.push({ role: "user", text });
}

function generatePattern(example: string): string {
  // Simple heuristics for common patterns
  if (/^DE\d{20}$/.test(example)) return 'DE\\d{20}';
  if (/^[A-Z]{2}\d{2}[\w\s]{1,30}$/.test(example)) return '[A-Z]{2}\\d{2}[\\w\\s]{1,30}'; // General IBAN
  if (/^\w+@\w+\.\w+$/.test(example)) return '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}';
  if (/^\d+$/.test(example)) return '\\d{' + example.length + ',}';
  
  // Fallback: escape regex special chars
  return example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startFlow() {
  pushAssistant(
    "Hi! Ich bin dein KI‑Haushaltmanager. Lade zuerst einen Kontoauszug als CSV hoch. Ich anonymisiere lokal im Browser und speichere nur die maskierten Umsätze.",
    [{ type: "file", label: "CSV auswählen", accept: ".csv,text/csv" }]
  );
}

onMounted(async () => {
  busy.value = true;
  try {
    await ensureSession();
    mappings.value = (await fetchBankMappings()) as BankMapping[];
    userRules.value = await fetchAnonRules();
  } catch (e: any) {
    pushAssistant("⚠️ Konnte Session oder Bank-Mappings nicht laden. Ist das Backend gestartet?");
  } finally {
    busy.value = false;
  }
  startFlow();
});

async function onFile(file: File) {
  if (!mappings.value.length) {
    pushAssistant("⚠️ Keine Bank-Mappings verfügbar. Backend prüfen.");
    return;
  }

  busy.value = true;
  pushUser(`Datei gewählt: ${file.name}`);

  try {
    const detection = await detectBankAndPrepare(file, mappings.value);
    if (detection.kind === "unknown") {
      pending.value = null;
      pushAssistant(
        "Ich konnte deine Bank noch nicht erkennen. Bitte gib den *Banknamen* ein (genau so wie er heißt). Dann kann Support ein Mapping erstellen.",
        [{ type: "text", label: "Bankname", placeholder: "z.B. comdirect" }]
      );
      return;
    }

    pending.value = {
      mapping: detection.mapping,
      header: detection.header,
      dataRows: detection.dataRows,
    };

    pushAssistant(
      `Ich erkenne das Format wahrscheinlich als **${detection.mapping.bank_name}**. Wie soll ich dieses Konto nennen? (z.B. Hauptkonto)`,
      [
        { type: "button", label: "Hauptkonto", value: "Hauptkonto" },
        { type: "button", label: "Kreditkarte", value: "Kreditkarte" },
        { type: "button", label: "Sparkonto", value: "Sparkonto" },
        { type: "text", label: "Konto-Name", placeholder: "z.B. Meine Visa" },
      ]
    );
  } catch (e: any) {
    console.error(e);
    pushAssistant("⚠️ CSV konnte nicht verarbeitet werden. Ist es wirklich eine CSV-Datei?");
  } finally {
    busy.value = false;
  }
}

async function onAction(value: string) {
  if (!value) return;

  // Handle anonymization choice
  if (value === 'anon:choose') {
    pushUser('Ja, mit Regeln');
    await showAnonymizationPreview();
    return;
  }

  if (value === 'anon:skip') {
    pushUser('Nein, Original speichern');
    await uploadTransactions(false);
    return;
  }

  // Handle rule toggle
  if (value.startsWith('toggle:')) {
    const ruleId = Number(value.replace('toggle:', ''));
    if (ruleToggles.value.has(ruleId)) {
      ruleToggles.value.delete(ruleId);
    } else {
      ruleToggles.value.add(ruleId);
    }

    // Re-apply anonymization with updated rules
    if (pendingPreview.value) {
      const activeRules = userRules.value.filter((r: any) => ruleToggles.value.has(r.id));
      const { data: anonymized } = await applyAnonymization(
        pendingPreview.value.original,
        activeRules
      );
      pendingPreview.value.anonymized = anonymized;
    }
    return;
  }

  // Handle rule creation
  if (value === 'rule:new') {
    pushUser('+ Neue Regel erstellen');
    pushAssistant(
      "Was möchtest du ersetzen? (z.B. eine IBAN, Email-Adresse, ...)",
      [{ type: 'text', label: 'Text zum Ersetzen', placeholder: 'z.B. DE12345...' }]
    );
    ruleCreationState.value = 'awaiting_example';
    return;
  }

  if (ruleCreationState.value === 'awaiting_example') {
    ruleCreationDraft.value.example = value;
    pushUser(value);
    pushAssistant(
      "Ersetzen durch?",
      [{ type: 'text', label: 'Ersatztext', placeholder: 'z.B. [IBAN]' }]
    );
    ruleCreationState.value = 'awaiting_replacement';
    return;
  }

  if (ruleCreationState.value === 'awaiting_replacement') {
    ruleCreationDraft.value.replacement = value;
    pushUser(value);
    
    // Generate pattern
    const generatedPattern = generatePattern(ruleCreationDraft.value.example);
    ruleCreationDraft.value.pattern = generatedPattern;
    
    pushAssistant(
      `Ich schlage vor: "${generatedPattern}" → "${value}"\n\nName für diese Regel?`,
      [
        { type: 'button', label: 'IBAN Maskierung', value: 'rulename:IBAN Maskierung' },
        { type: 'button', label: 'Bankdaten', value: 'rulename:Bankdaten' },
        { type: 'button', label: 'Kontonummer', value: 'rulename:Kontonummer' },
        { type: 'text', label: 'Eigener Name', placeholder: 'z.B. Meine IBAN-Regel' },
      ]
    );
    ruleCreationState.value = 'awaiting_name';
    return;
  }

  if (ruleCreationState.value === 'awaiting_name') {
    const ruleName = value.startsWith('rulename:') ? value.replace('rulename:', '') : value;
    pushUser(ruleName);
    
    busy.value = true;
    try {
      const newRule = await createAnonRule({
        name: ruleName,
        pattern: ruleCreationDraft.value.pattern,
        flags: 'gi',
        replacement: ruleCreationDraft.value.replacement,
      });
      
      userRules.value.push(newRule);
      pushAssistant(`✓ Regel "${ruleName}" erstellt!`);
      
      // Reset and re-show preview
      ruleCreationState.value = 'idle';
      ruleCreationDraft.value = {};
      await showAnonymizationPreview();
    } catch (e: any) {
      console.error("Rule creation error:", e);
      if (e.message.includes('409')) {
        pushAssistant('⚠️ Eine Regel mit diesem Namen existiert bereits. Bitte wähle einen anderen Namen.');
        ruleCreationState.value = 'awaiting_name';
      } else {
        pushAssistant('⚠️ Fehler beim Erstellen der Regel.');
      }
    } finally {
      busy.value = false;
    }
    return;
  }

  // Handle upload
  if (value === 'upload:yes') {
    pushUser('✓ So speichern');
    await uploadTransactions(true);
    return;
  }

  // Bank support request
  // If we are waiting for bank name (unknown bank)
  if (!pending.value) {
    const bankName = value.trim();
    if (!bankName) return;
    busy.value = true;
    pushUser(bankName);
    try {
      await requestBankSupport(bankName);
      pushAssistant(
        `Danke! Ich habe „${bankName}“ an Support gemeldet. Sobald ein Mapping existiert, kannst du die CSV erneut hochladen.`,
        [{ type: "file", label: "CSV erneut auswählen", accept: ".csv,text/csv" }]
      );
    } catch (e) {
      pushAssistant("⚠️ Anfrage konnte nicht gesendet werden. Backend prüfen.");
    } finally {
      busy.value = false;
    }
    return;
  }

  // Otherwise this is the account alias
  const alias = value.trim();
  if (!alias) return;
  pushUser(alias);
  await runImport(alias);
}

async function runImport(accountAlias: string) {
  if (!pending.value) return;

  busy.value = true;
  try {
    pushAssistant("Alles klar. Ich bereite die Umsätze vor...");

    // Parse original transactions
    const original = buildOriginalTransactions({
      mapping: pending.value.mapping,
      header: pending.value.header,
      dataRows: pending.value.dataRows,
      accountAlias,
    });

    pendingAlias.value = accountAlias;
    pendingPreview.value = { original, anonymized: original };

    // Ask about anonymization
    pushAssistant(
      `${original.length} Transaktionen gefunden. Möchtest du sie anonymisieren?`,
      [
        { type: 'button', label: '✓ Ja, mit Regeln', value: 'anon:choose' },
        { type: 'button', label: '✗ Nein, Original speichern', value: 'anon:skip' },
      ]
    );
  } catch (e) {
    console.error("Parse error:", e);
    pushAssistant("⚠️ Fehler beim Parsen der Transaktionen.");
  } finally {
    busy.value = false;
  }
}

async function showAnonymizationPreview() {
  if (!pendingPreview.value) return;

  busy.value = true;
  try {
    // Initialize all rules as ACTIVE
    ruleToggles.value = new Set(userRules.value.map((r: any) => r.id));

    // Apply all active rules
    const activeRules = userRules.value.filter((r: any) => ruleToggles.value.has(r.id));
    const { data: anonymized } = await applyAnonymization(
      pendingPreview.value.original,
      activeRules
    );

    pendingPreview.value.anonymized = anonymized;

    const actions: Action[] = [];

    // Show rule toggles
    if (userRules.value.length > 0) {
      actions.push(...userRules.value.map((rule: any) => ({
        type: 'toggle',
        id: rule.id,
        label: rule.name,
        active: true,
        value: `toggle:${rule.id}`,
      })));
    }

    actions.push(
      { type: 'button', label: '+ Neue Regel erstellen', value: 'rule:new' },
      { type: 'button', label: '✓ So speichern', value: 'upload:yes' }
    );

    pushAssistant(
      userRules.value.length > 0
        ? "Wähle welche Regeln angewendet werden sollen:"
        : "Du hast noch keine Regeln. Erstelle eine oder speichere ohne Anonymisierung:",
      actions
    );
  } finally {
    busy.value = false;
  }
}

async function uploadTransactions(useAnon: boolean) {
  if (!pendingPreview.value || !pending.value || !pendingAlias.value) return;

  busy.value = true;
  try {
    const data = useAnon ? pendingPreview.value.anonymized : pendingPreview.value.original;

    pushAssistant(`Speichere ${data.length} Transaktionen...`);

    const acc = await createAccount(pending.value.mapping.bank_name, pendingAlias.value);
    const imp = await createImport(acc.id);

    const upload = data.map((t: any) => ({
      bank_name: t.bank_name,
      booking_date: t.booking_date,
      booking_date_raw: t.booking_date_raw,
      booking_date_iso: t.booking_date_iso,
      booking_text: t.booking_text,
      booking_type: t.booking_type,
      booking_amount: t.booking_amount,
      booking_amount_value: parseFloat(t.booking_amount.replace(/[^\d,-]/g, '').replace(',', '.')),
      booking_hash: t.booking_hash,
    }));

    const up = await uploadMaskedTransactions({
      import_id: imp.import_id,
      account_id: acc.id,
      transactions: upload,
    });

    pushAssistant(`✅ ${up.inserted} Transaktionen gespeichert!`, [
      { type: 'file', label: 'Weitere CSV importieren', accept: '.csv,text/csv' },
    ]);

    // Reset state
    pending.value = null;
    pendingAlias.value = '';
    pendingPreview.value = null;
    ruleCreationState.value = 'idle';
  } catch (e: any) {
    console.error("Upload error:", e);
    pushAssistant("⚠️ Fehler beim Speichern der Transaktionen.");
  } finally {
    busy.value = false;
  }
}

async function sendChat() {
  const text = composer.value.trim();
  if (!text) return;
  pushUser(text);
  composer.value = "";
  busy.value = true;
  try {
    const out = await apiSendChat(text);
    pushAssistant(out.message || "", Array.isArray(out.actions) ? (out.actions as Action[]) : []);
  } catch (e: any) {
    console.error(e);
    pushAssistant("⚠️ Chat fehlgeschlagen. Prüfe LLM_PROVIDER/Keys oder Backend-Logs.");
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.shell { max-width: 720px; margin: 0 auto; padding: 14px; display:flex; flex-direction:column; gap:12px; min-height: 100vh; }
.top { padding: 6px 2px; }
.brand { font-weight: 700; font-size: 20px; }
.sub { color:#666; font-size: 14px; margin-top: 4px; }
.chat { flex: 1; display:flex; flex-direction:column; gap: 12px; padding: 8px 0; }
.bubble { max-width: 92%; padding: 12px 12px; border-radius: 16px; border: 1px solid #eee; background:#fff; }
.bubble.user { margin-left: auto; background:#fafafa; }
.text { white-space: pre-wrap; line-height: 1.35; }
.composer { display:flex; gap: 10px; padding: 10px 0 4px; }
.input { flex: 1; border: 1px solid #ddd; border-radius: 14px; padding: 12px; font-size: 15px; }
.send { border:1px solid #ddd; border-radius: 14px; padding: 12px 14px; background: #fff; }
</style>
