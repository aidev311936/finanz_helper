<template>
  <main class="shell">
    <header class="top">
      <div class="brand">Haushaltmanager</div>
      <div class="sub">Minimiere Ausgaben – ohne Tabellen-Chaos.</div>
      <div class="view-tabs">
        <button class="view-tab" :class="{ active: currentView === 'import' }" @click="currentView = 'import'">
          Import
        </button>
        <button class="view-tab" :class="{ active: currentView === 'saved' }" @click="currentView = 'saved'">
          Gespeicherte Transaktionen
        </button>
      </div>
    </header>

    <div class="content-grid">
      <section ref="chatContainer" class="chat">
        <div v-for="(m, idx) in messages" :key="idx" class="bubble" :class="m.role">
          <div class="text">{{ m.text }}</div>
          <ActionRenderer v-if="m.actions && m.actions.length" :key="actionRefreshKey" :actions="m.actions"
            @action="onAction" @file="onFile" />
        </div>
      </section>

      <section class="preview">
        <!-- Import View -->
        <div v-if="currentView === 'import'">
          <!-- Progress Checklist -->
          <ProgressChecklist :steps="importSteps" :current-step="currentImportStep" :account-alias="pendingAlias"
            :rules="userRules" :active-rules="ruleToggles" @change-alias="handleAliasChange"
            @rule-context="handleRuleContext" />

          <div v-if="pendingPreview" class="preview-container">
            <div class="preview-header">
              <h3 class="preview-title">Transaktionen Vorschau ({{ displayedTransactions.length }})</h3>
              <button class="view-toggle" @click="showOriginal = !showOriginal" :class="{ active: showOriginal }">
                {{ showOriginal ? 'Original' : 'Anonymisiert' }}
              </button>
            </div>
            <div class="table-wrapper" @mouseup="handleTextSelection">
              <table class="tx-table">
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Buchungstext</th>
                    <th>Typ</th>
                    <th>Betrag</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(tx, idx) in displayedTransactions" :key="idx">
                    <td>{{ tx.booking_date || 'N/A' }}</td>
                    <td>{{ tx.booking_text }}</td>
                    <td>{{ tx.booking_type }}</td>
                    <td class="amount">{{ tx.booking_amount }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else class="preview-empty">
            <p>Keine Vorschau verfügbar</p>
            <p class="hint">Lade eine CSV-Datei hoch, um die Transaktionen hier zu sehen.</p>
          </div>
        </div>

        <!-- Saved Transactions View -->
        <TransactionList v-else-if="currentView === 'saved'" />
      </section>
    </div>

    <!-- Floating selection button -->
    <button v-if="selectedText && selectionPosition" class="selection-button"
      :style="{ left: selectionPosition.x + 'px', top: selectionPosition.y + 'px' }" @click="createRuleFromSelection">
      Regel erstellen
    </button>

    <footer class="composer">
      <input class="input" v-model="composer" :disabled="busy" placeholder="Schreib mir z.B. 'Zeig mir alle Abos'..."
        @keydown.enter.prevent="sendChat" />
      <button class="send" :disabled="busy || !composer.trim()" @click="sendChat">Senden</button>
    </footer>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, nextTick, computed } from "vue";
import ActionRenderer from "./components/ActionRenderer.vue";
import ProgressChecklist from "./components/ProgressChecklist.vue";
import TransactionList from "./components/TransactionList.vue";
import type { Action, ChatMessage } from "./types";
import { ensureSession, fetchBankMappings, requestBankSupport, createAccount, createImport, uploadMaskedTransactions, sendChat as apiSendChat, fetchAnonRules, createAnonRule, deleteAnonRule } from "./api";
import type { BankMapping } from "./lib/types";
import { buildMaskedTransactions, detectBankAndPrepare, buildOriginalTransactions } from "./lib/importPipeline";
import { applyAnonymization } from "./lib/anonymize";

const messages = ref<ChatMessage[]>([]);
const composer = ref("");
const busy = ref(false);
const currentView = ref<'import' | 'saved'>('import');

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
const ruleEditState = ref<{ ruleId: number; step: 'awaiting_pattern' | 'awaiting_replacement' } | null>(null);
const pendingAlias = ref<string>('');
const pendingPreview = ref<{ original: any[]; anonymized: any[] } | null>(null);
const showOriginal = ref(false);
const actionRefreshKey = ref(0);

// Text selection for rule creation
const selectedText = ref('');
const selectionPosition = ref<{ x: number, y: number } | null>(null);

// Computed property for transactions to display in preview
const displayedTransactions = computed(() => {
  if (!pendingPreview.value) return [];
  return showOriginal.value ? pendingPreview.value.original : pendingPreview.value.anonymized;
});

// Import progress tracking
const importSteps = computed(() => [
  {
    id: 'csv',
    label: 'CSV Hochladen',
    meta: pending.value?.mapping?.bank_name || '',
    completed: !!pending.value
  },
  {
    id: 'alias',
    label: 'Konto Alias',
    meta: pendingAlias.value,
    completed: !!pendingAlias.value,
    editable: true
  },
  {
    id: 'rules',
    label: 'Anonymisierungsregeln erstellt',
    completed: userRules.value.length > 0,
    children: userRules.value.map((r: any) => ({
      id: Number(r.id),
      label: r.name,
      active: ruleToggles.value.has(Number(r.id)),
      editable: true,
      deletable: true
    }))
  },
  {
    id: 'save',
    label: 'Anonymisierte Daten speichern',
    completed: false
  }
]);

const currentImportStep = computed(() => {
  const steps = importSteps.value;
  const completed = steps.filter((s: any) => s.completed).length;
  return {
    current: completed,
    total: steps.length,
    percentage: Math.round((completed / steps.length) * 100)
  };
});

const chatContainer = ref<HTMLElement | null>(null);

function scrollChatToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  });
}

function pushAssistant(text: string, actions: Action[] = []) {
  messages.value.push({ role: "assistant", text, actions });
  scrollChatToBottom();
}
function pushUser(text: string) {
  messages.value.push({ role: "user", text });
  scrollChatToBottom();
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

function handleTextSelection(event: MouseEvent) {
  const selection = window.getSelection();
  const text = selection?.toString().trim();

  if (text && text.length > 0) {
    selectedText.value = text;
    selectionPosition.value = { x: event.clientX, y: event.clientY };
  } else {
    clearSelection();
  }
}

function clearSelection() {
  selectedText.value = '';
  selectionPosition.value = null;
  window.getSelection()?.removeAllRanges();
}

function createRuleFromSelection() {
  if (!selectedText.value) return;

  ruleCreationDraft.value = { example: selectedText.value };
  ruleCreationState.value = 'awaiting_replacement';

  pushAssistant(
    `Ich schlage vor: "${selectedText.value}"

Ersetzen durch?`,
    [{ type: 'text', label: 'Ersetzen durch', placeholder: 'z.B. [IBAN]' }]
  );

  clearSelection();
  scrollChatToBottom();
}

function handleAliasChange() {
  pushUser('Konto-Alias ändern');
  pushAssistant(
    'Wie soll das Konto heißen?',
    [
      { type: 'button', label: pendingAlias.value || 'Hauptkonto', value: `alias:${pendingAlias.value}` },
      { type: 'text', label: 'Neuer Alias', placeholder: 'z.B. Sparkonto' }
    ]
  );
}

async function handleRuleContext(action: string, ruleId: number) {
  const rule = userRules.value.find((r: any) => Number(r.id) === ruleId);
  if (!rule) return;

  switch (action) {
    case 'toggle':
      await onAction(`toggle:${ruleId}`);
      break;

    case 'edit':
      pushUser(`Regel "${rule.name}" ändern`);

      // Set edit state to track this rule
      ruleEditState.value = {
        ruleId: ruleId,
        step: 'awaiting_pattern',
        currentRule: rule
      };

      pushAssistant(
        `Aktuelle Regel: "${rule.pattern}" → "${rule.replacement}"

Was möchtest du ändern?`,
        [
          { type: 'text', label: 'Neues Pattern (was ersetzen)', placeholder: rule.pattern },
          { type: 'text', label: 'Neuer Replacement (womit ersetzen)', placeholder: rule.replacement }
        ]
      );
      break;

    case 'delete':
      pushUser(`Regel "${rule.name}" löschen`);
      await deleteRule(ruleId);
      break;
  }
}

async function deleteRule(ruleId: number) {
  const rule = userRules.value.find((r: any) => Number(r.id) === ruleId);
  const ruleName = rule?.name || 'Regel';

  busy.value = true;
  try {
    await deleteAnonRule(ruleId);

    userRules.value = userRules.value.filter((r: any) => Number(r.id) !== ruleId);
    ruleToggles.value.delete(ruleId);

    pushAssistant(`✓ Regel "${ruleName}" gelöscht`);

    if (pendingPreview.value) {
      const activeRules = userRules.value.filter((r: any) =>
        ruleToggles.value.has(Number(r.id))
      );
      const { data: anonymized } = await applyAnonymization(
        pendingPreview.value.original,
        activeRules
      );
      pendingPreview.value.anonymized = anonymized;
    }
  } catch (e) {
    console.error(e);
    pushAssistant('⚠️ Fehler beim Löschen der Regel');
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
    console.log('[Toggle] Clicked:', value);
    const ruleId = Number(value.replace('toggle:', ''));
    console.log('[Toggle] Rule ID:', ruleId);
    console.log('[Toggle] Before:', Array.from(ruleToggles.value));

    if (ruleToggles.value.has(ruleId)) {
      ruleToggles.value.delete(ruleId);
    } else {
      ruleToggles.value.add(ruleId);
    }

    console.log('[Toggle] After:', Array.from(ruleToggles.value));

    // Re-apply anonymization with updated rules
    if (pendingPreview.value) {
      const activeRules = userRules.value.filter((r: any) => ruleToggles.value.has(Number(r.id)));
      console.log('[Toggle] Active rules count:', activeRules.length);

      const { data: anonymized } = await applyAnonymization(
        pendingPreview.value.original,
        activeRules
      );
      pendingPreview.value.anonymized = anonymized;
      console.log('[Toggle] Anonymized:', anonymized.length, 'transactions');

      // Update the last message's actions to reflect new toggle states
      const lastIndex = messages.value.length - 1;
      const lastMsg = messages.value[lastIndex];
      if (lastMsg && lastMsg.role === 'assistant') {
        const newActions = buildAnonymizationActions();
        console.log('[Toggle] New actions:', newActions);
        messages.value[lastIndex] = {
          ...lastMsg,
          actions: newActions
        };
        // Force component re-render by updating key
        actionRefreshKey.value++;
        console.log('[Toggle] Refresh key:', actionRefreshKey.value);
      }
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

    const suggestedName = `"${ruleCreationDraft.value.example}" → "${value}"`;

    pushAssistant(
      `Ich schlage vor: "${generatedPattern}" → "${value}"\n\nName für diese Regel?`,
      [
        { type: 'button', label: suggestedName, value: `rulename:${suggestedName}` },
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

function buildAnonymizationActions(): Action[] {
  const actions: Action[] = [];

  // Show rule toggles with current active states (ensure Number comparison!)
  if (userRules.value.length > 0) {
    actions.push(...userRules.value.map((rule: any) => ({
      type: 'toggle',
      id: rule.id,
      label: rule.name,
      active: ruleToggles.value.has(Number(rule.id)),
      value: `toggle:${rule.id}`,
    })));
  }

  actions.push(
    { type: 'button', label: '+ Neue Regel erstellen', value: 'rule:new' },
    { type: 'button', label: '✓ So speichern', value: 'upload:yes' }
  );

  return actions;
}

async function showAnonymizationPreview() {
  if (!pendingPreview.value) return;

  busy.value = true;
  try {
    // Initialize all rules as ACTIVE (ensure IDs are Numbers!)
    ruleToggles.value = new Set(userRules.value.map((r: any) => Number(r.id)));

    // Apply all active rules (ensure Number comparison!)
    const activeRules = userRules.value.filter((r: any) => ruleToggles.value.has(Number(r.id)));
    const { data: anonymized } = await applyAnonymization(
      pendingPreview.value.original,
      activeRules
    );

    pendingPreview.value.anonymized = anonymized;

    pushAssistant(
      userRules.value.length > 0
        ? "Wähle welche Regeln angewendet werden sollen:"
        : "Du hast noch keine Regeln. Erstelle eine oder speichere ohne Anonymisierung:",
      buildAnonymizationActions()
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
.shell {
  max-width: 100%;
  height: 100vh;
  margin: 0 auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.top {
  padding: 6px 2px;
  flex-shrink: 0;
}

.brand {
  font-weight: 700;
  font-size: 20px;
}

.sub {
  color: #666;
  font-size: 14px;
  margin-top: 4px;
}

.view-tabs {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.view-tab {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  font-size: 14px;
  color: #666;
  cursor: pointer;
  transition: all 0.2s;
}

.view-tab:hover {
  background: #f5f5f5;
  border-color: #bbb;
}

.view-tab.active {
  background: #1976d2;
  color: white;
  border-color: #1976d2;
  font-weight: 500;
}

.content-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.chat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0;
  overflow-y: auto;
  height: 100%;
}

.bubble {
  max-width: 92%;
  padding: 12px 12px;
  border-radius: 16px;
  border: 1px solid #eee;
  background: #fff;
}

.bubble.user {
  margin-left: auto;
  background: #fafafa;
}

.text {
  white-space: pre-wrap;
  line-height: 1.35;
}

.preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #eee;
  border-radius: 12px;
  background: #fff;
  height: 100%;
}

.preview-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}

.preview-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.view-toggle {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.view-toggle:hover {
  background: #f5f5f5;
}

.view-toggle.active {
  background: #1a73e8;
  color: #fff;
  border-color: #1a73e8;
}

.table-wrapper {
  flex: 1;
  overflow-y: auto;
}

.tx-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.tx-table thead {
  position: sticky;
  top: 0;
  background: #f9f9f9;
  z-index: 1;
}

.tx-table th {
  text-align: left;
  padding: 10px 12px;
  font-weight: 600;
  border-bottom: 2px solid #ddd;
}

.tx-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.tx-table tr:hover {
  background: #fafafa;
}

.tx-table .amount {
  text-align: right;
  font-family: monospace;
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  padding: 40px;
  text-align: center;
}

.preview-empty p {
  margin: 0;
}

.preview-empty .hint {
  font-size: 13px;
  margin-top: 8px;
}

.selection-button {
  position: fixed;
  padding: 8px 12px;
  background: #1a73e8;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  transition: all 0.2s;
  transform: translate(-50%, -120%);
}

.selection-button:hover {
  background: #1557b0;
  transform: translate(-50%, -120%) translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.composer {
  display: flex;
  gap: 10px;
  padding: 10px 0 4px;
  flex-shrink: 0;
}

.input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 14px;
  padding: 12px;
  font-size: 15px;
}

.send {
  border: 1px solid #ddd;
  border-radius: 14px;
  padding: 12px 14px;
  background: #fff;
}
</style>
