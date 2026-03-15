<template>
  <main class="shell">
    <header class="top">
      <div class="brand">Haushalthelfer</div>
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

    <div class="content-area">

      <section class="preview">
        <!-- Notification Banner -->
        <div v-if="notification" class="notification-banner" :class="notification.type" @click="notification = null">
          {{ notification.text }}
        </div>
        <!-- Import View -->
        <div v-if="currentView === 'import'" class="import-view">
          <!-- Progress Checklist -->
          <ProgressChecklist :steps="importSteps" :current-step="currentImportStep" :account-alias="pendingAlias"
            :rules="userRules" :active-rules="ruleToggles" @change-alias="handleAliasChange"
            @rule-context="handleRuleContext" @file-upload="onFile"
            @new-rule="showRuleModal = true; ruleModalInitialExample = ''" />

          <div v-if="pendingPreview" class="preview-container">
            <div class="preview-header">
              <h3 class="preview-title">Transaktionen Vorschau ({{ previewStats.filtered }} / {{ previewStats.total }})
              </h3>
              <div class="preview-stats-line">
                <span class="stat-badge stat-anon">✓ {{ previewStats.anonymized }}</span>
                <span class="stat-badge stat-ok">◉ {{ previewStats.ok }}</span>
                <span class="stat-badge stat-unchecked">○ {{ previewStats.unchecked }}</span>
              </div>
              <button class="view-toggle" @click="showOriginal = !showOriginal" :class="{ active: showOriginal }">
                {{ showOriginal ? 'Original' : 'Anonymisiert' }}
              </button>
            </div>

            <!-- Filter Bar -->
            <div class="preview-filter-bar">
              <div class="filter-pills">
                <button class="filter-pill" :class="{ active: previewFilter === 'all' }"
                  @click="previewFilter = 'all'">Alle</button>
                <button class="filter-pill" :class="{ active: previewFilter === 'anonymized' }"
                  @click="previewFilter = 'anonymized'">✓ Anonymisiert</button>
                <button class="filter-pill" :class="{ active: previewFilter === 'already_anonymous' }"
                  @click="previewFilter = 'already_anonymous'">◉ Bereits OK</button>
                <button class="filter-pill" :class="{ active: previewFilter === 'dont_care' }"
                  @click="previewFilter = 'dont_care'">○ Nicht geprüft</button>
              </div>
              <div class="filter-actions">
                <button v-if="previewStats.unchecked > 0" class="filter-pill mark-all-ok" @click="markAllOk">
                  ◉ Alle OK ({{ previewStats.unchecked }})
                </button>
                <label class="hide-toggle">
                  <input type="checkbox" v-model="hideReviewed" />
                  Geprüfte ausblenden
                </label>
              </div>
            </div>

            <div class="table-wrapper" @mouseup="handleTextSelection">
              <table class="tx-table">
                <thead>
                  <tr>
                    <th class="status-col">Status</th>
                    <th class="date-col">Datum</th>
                    <th class="text-col">Buchungstext</th>
                    <th class="rules-col">Regeln</th>
                    <th class="type-col">Typ</th>
                    <th class="amount-col">Betrag</th>
                    <th class="action-col">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="tx in displayedTransactions" :key="tx._idx"
                    :class="{ 'completed': tx._status === 'already_anonymous' }">
                    <td class="status-col">
                      <StatusBadge :status="tx._status" />
                    </td>
                    <td class="date-col">{{ tx.booking_date || 'N/A' }}</td>
                    <td class="text-col">{{ tx.booking_text }}</td>
                    <td class="rules-col">
                      <span v-if="tx._matchedRules.length > 0" class="rule-badge"
                        :title="getRuleNamesForRow(tx._matchedRules).join(', ')">
                        {{ tx._matchedRules.length }} {{ tx._matchedRules.length === 1 ? 'Regel' : 'Regeln' }}
                      </span>
                      <span v-else class="rule-badge empty">Keine</span>
                    </td>
                    <td class="type-col">{{ tx.booking_type }}</td>
                    <td class="amount-col">{{ tx.booking_amount }}</td>
                    <td class="action-col">
                      <div class="action-menu" v-if="openPreviewMenuId === tx._idx" @click.stop>
                        <div class="menu-backdrop" @click="closePreviewMenu"></div>
                        <div class="menu-dropdown">
                          <button class="menu-item" :disabled="tx._status === 'already_anonymous'"
                            @click="changePreviewStatus(tx._idx, 'already_anonymous')">
                            ◉ Als OK markieren
                          </button>
                          <button class="menu-item" :disabled="tx._status === 'dont_care'"
                            @click="changePreviewStatus(tx._idx, 'dont_care')">
                            ○ Zurücksetzen
                          </button>
                        </div>
                      </div>
                      <button class="action-button" @click.stop="togglePreviewMenu(tx._idx)">⋮</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else class="preview-empty">
            <p>Keine Vorschau verfügbar</p>
            <p class="hint">Lade eine CSV-Datei hoch, um die Transaktionen hier zu sehen.</p>
          </div>

          <!-- Action Bar -->
          <div v-if="pendingPreview" class="action-bar">
            <button class="action-bar-btn primary" @click="handleImportClick">
              ✓ Importieren ({{ previewStats.anonymized + previewStats.ok }} geprüft)
            </button>
            <button class="action-bar-btn" @click="showRuleModal = true">
              + Neue Regel
            </button>
            <button class="action-bar-btn" @click="handleOriginalImport">
              Original speichern
            </button>
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

    <!-- Rule Creation Modal -->
    <RuleCreationModal v-if="showRuleModal" :initial-example="ruleModalInitialExample" @close="closeRuleModal"
      @create="handleRuleCreated" />

    <!-- Import Confirmation Modal -->
    <div v-if="showImportConfirm" class="modal-overlay" @click.self="showImportConfirm = false">
      <div class="modal-content">
        <h3>Import bestätigen</h3>
        <p>Es gibt noch {{ previewStats.unchecked }} ungeprüfte Umsätze.</p>
        <div class="modal-actions">
          <button class="modal-btn primary" @click="confirmImportAllOk">Alle als OK markieren</button>
          <button class="modal-btn" @click="confirmImportReviewed">Nur geprüfte importieren</button>
          <button class="modal-btn cancel" @click="showImportConfirm = false">Abbrechen</button>
        </div>
      </div>
    </div>

    <!-- Alias Input Modal -->
    <div v-if="showAliasModal" class="modal-overlay" @click.self="showAliasModal = false">
      <div class="modal-content">
        <h3>Konto-Alias</h3>
        <p>Wie soll dieses Konto heißen?</p>
        <div class="alias-buttons">
          <button class="modal-btn" @click="setAlias('Hauptkonto')">Hauptkonto</button>
          <button class="modal-btn" @click="setAlias('Kreditkarte')">Kreditkarte</button>
          <button class="modal-btn" @click="setAlias('Sparkonto')">Sparkonto</button>
        </div>
        <form class="alias-form" @submit.prevent="setAlias(aliasInput)">
          <input v-model="aliasInput" class="alias-input" placeholder="z.B. Meine Visa" />
          <button type="submit" class="modal-btn primary" :disabled="!aliasInput.trim()">OK</button>
        </form>
        <button class="modal-btn cancel" @click="showAliasModal = false">Abbrechen</button>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import ProgressChecklist from "./components/ProgressChecklist.vue";
import TransactionList from "./components/TransactionList.vue";
import StatusBadge from "./components/StatusBadge.vue";
import RuleCreationModal from "./components/RuleCreationModal.vue";
import { ensureSession, fetchBankMappings, createAccount, createImport, uploadMaskedTransactions, fetchAnonRules, createAnonRule, deleteAnonRule } from "./api";
import type { BankMapping } from "./lib/types";
import { detectBankAndPrepare, buildOriginalTransactions } from "./lib/importPipeline";
import { applyAnonymization } from "./lib/anonymize";

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
const pendingAlias = ref<string>('');
const pendingPreview = ref<{ original: any[]; anonymized: any[] } | null>(null);
const showOriginal = ref(false);

// Modal state
const showRuleModal = ref(false);
const ruleModalInitialExample = ref('');
const showImportConfirm = ref(false);
const showAliasModal = ref(false);
const aliasInput = ref('');

// Notification
const notification = ref<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
function notify(text: string, type: 'success' | 'error' | 'info' = 'info') {
  notification.value = { text, type };
  if (type !== 'error') {
    setTimeout(() => notification.value = null, 4000);
  }
}

// Text selection for rule creation
const selectedText = ref('');
const selectionPosition = ref<{ x: number, y: number } | null>(null);

// Preview status tracking (index-based, pre-import)
const previewStatuses = ref<Map<number, string>>(new Map());
const previewMatchedRules = ref<Map<number, number[]>>(new Map());
const previewFilter = ref<'all' | 'anonymized' | 'already_anonymous' | 'dont_care'>('all');
const hideReviewed = ref(false);
const openPreviewMenuId = ref<number | null>(null);

// Computed: enrich preview transactions with status + matched rules
const enrichedPreviewTransactions = computed(() => {
  if (!pendingPreview.value) return [];
  const source = showOriginal.value ? pendingPreview.value.original : pendingPreview.value.anonymized;
  return source.map((tx: any, idx: number) => ({
    ...tx,
    _idx: idx,
    _status: previewStatuses.value.get(idx) || 'dont_care',
    _matchedRules: previewMatchedRules.value.get(idx) || [],
  }));
});

// Computed: filtered preview transactions
const filteredPreviewTransactions = computed(() => {
  let result = enrichedPreviewTransactions.value;
  if (previewFilter.value !== 'all') {
    result = result.filter((tx: any) => tx._status === previewFilter.value);
  }
  if (hideReviewed.value) {
    result = result.filter((tx: any) => tx._status !== 'already_anonymous');
  }
  return result;
});

// Alias for template display
const displayedTransactions = filteredPreviewTransactions;

// Preview stats
const previewStats = computed(() => {
  const all = enrichedPreviewTransactions.value;
  return {
    total: all.length,
    filtered: filteredPreviewTransactions.value.length,
    anonymized: all.filter((t: any) => t._status === 'anonymized').length,
    ok: all.filter((t: any) => t._status === 'already_anonymous').length,
    unchecked: all.filter((t: any) => t._status === 'dont_care').length,
  };
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

function generatePattern(example: string): string {
  if (/^DE\d{20}$/.test(example)) return 'DE\\d{20}';
  if (/^[A-Z]{2}\d{2}[\w\s]{1,30}$/.test(example)) return '[A-Z]{2}\\d{2}[\\w\\s]{1,30}';
  if (/^\w+@\w+\.\w+$/.test(example)) return '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}';
  if (/^\d+$/.test(example)) return '\\d{' + example.length + ',}';
  return example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

onMounted(async () => {
  busy.value = true;
  try {
    await ensureSession();
    mappings.value = (await fetchBankMappings()) as BankMapping[];
    userRules.value = await fetchAnonRules();
  } catch (e: any) {
    notify("⚠️ Konnte Session oder Bank-Mappings nicht laden. Ist das Backend gestartet?", 'error');
  } finally {
    busy.value = false;
  }
});

// === File Upload (CSV) ===
async function onFile(file: File) {
  if (!mappings.value.length) {
    notify("⚠️ Keine Bank-Mappings verfügbar. Backend prüfen.", 'error');
    return;
  }

  busy.value = true;
  try {
    const detection = await detectBankAndPrepare(file, mappings.value);
    if (detection.kind === "unknown") {
      pending.value = null;
      notify("Bank nicht erkannt. Bitte Support kontaktieren.", 'error');
      return;
    }

    pending.value = {
      mapping: detection.mapping,
      header: detection.header,
      dataRows: detection.dataRows,
    };

    notify(`Bank erkannt: ${detection.mapping.bank_name}`, 'success');
    // Open alias modal to ask for account name
    aliasInput.value = '';
    showAliasModal.value = true;
  } catch (e: any) {
    console.error(e);
    notify("⚠️ CSV konnte nicht verarbeitet werden.", 'error');
  } finally {
    busy.value = false;
  }
}

// === Alias ===
function handleAliasChange() {
  aliasInput.value = pendingAlias.value;
  showAliasModal.value = true;
}

async function setAlias(alias: string) {
  const trimmed = alias.trim();
  if (!trimmed) return;
  showAliasModal.value = false;
  await runImport(trimmed);
}

async function runImport(accountAlias: string) {
  if (!pending.value) return;

  busy.value = true;
  try {
    const original = buildOriginalTransactions({
      mapping: pending.value.mapping,
      header: pending.value.header,
      dataRows: pending.value.dataRows,
      accountAlias,
    });

    pendingAlias.value = accountAlias;
    pendingPreview.value = { original, anonymized: original };

    notify(`${original.length} Transaktionen geladen.`, 'success');

    // Auto-apply anonymization if rules exist
    if (userRules.value.length > 0) {
      await showAnonymizationPreview();
    }
  } catch (e) {
    console.error("Parse error:", e);
    notify("⚠️ Fehler beim Parsen der Transaktionen.", 'error');
  } finally {
    busy.value = false;
  }
}

// === Text Selection ===
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
  ruleModalInitialExample.value = selectedText.value;
  showRuleModal.value = true;
  clearSelection();
}

// === Rule Management ===
function closeRuleModal() {
  showRuleModal.value = false;
  ruleModalInitialExample.value = '';
}

async function handleRuleCreated(ruleData: { name: string; pattern: string; replacement: string }) {
  busy.value = true;
  try {
    const newRule = await createAnonRule({
      name: ruleData.name,
      pattern: ruleData.pattern,
      flags: 'gi',
      replacement: ruleData.replacement,
    });

    userRules.value.push(newRule);
    ruleToggles.value.add(Number(newRule.id));

    notify(`✓ Regel "${ruleData.name}" erstellt!`, 'success');
    showRuleModal.value = false;
    ruleModalInitialExample.value = '';

    // Re-apply anonymization
    if (pendingPreview.value) {
      await showAnonymizationPreview();
    }
  } catch (e: any) {
    console.error("Rule creation error:", e);
    if (e.message?.includes('409')) {
      notify('⚠️ Eine Regel mit diesem Namen existiert bereits.', 'error');
    } else {
      notify('⚠️ Fehler beim Erstellen der Regel.', 'error');
    }
  } finally {
    busy.value = false;
  }
}

async function handleRuleContext(action: string, ruleId: number) {
  const rule = userRules.value.find((r: any) => Number(r.id) === ruleId);
  if (!rule) return;

  switch (action) {
    case 'toggle':
      await toggleRule(ruleId);
      break;
    case 'delete':
      await deleteRule(ruleId);
      break;
  }
}

async function toggleRule(ruleId: number) {
  if (ruleToggles.value.has(ruleId)) {
    ruleToggles.value.delete(ruleId);
  } else {
    ruleToggles.value.add(ruleId);
  }

  if (pendingPreview.value) {
    const activeRules = userRules.value.filter((r: any) => ruleToggles.value.has(Number(r.id)));
    const { data: anonymized } = await applyAnonymization(
      pendingPreview.value.original,
      activeRules
    );
    pendingPreview.value.anonymized = anonymized;
    computePreviewStatuses();
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
    notify(`✓ Regel "${ruleName}" gelöscht`, 'success');

    if (pendingPreview.value) {
      const activeRules = userRules.value.filter((r: any) =>
        ruleToggles.value.has(Number(r.id))
      );
      const { data: anonymized } = await applyAnonymization(
        pendingPreview.value.original,
        activeRules
      );
      pendingPreview.value.anonymized = anonymized;
      computePreviewStatuses();
    }
  } catch (e) {
    console.error(e);
    notify('⚠️ Fehler beim Löschen der Regel', 'error');
  } finally {
    busy.value = false;
  }
}

// === Import ===
function markAllOk() {
  for (const [idx, status] of previewStatuses.value) {
    if (status === 'dont_care') {
      previewStatuses.value.set(idx, 'already_anonymous');
    }
  }
  previewStatuses.value = new Map(previewStatuses.value);
  notify(`${previewStats.value.unchecked === 0 ? 'Alle' : ''} Umsätze als OK markiert`, 'success');
}

function handleImportClick() {
  const unchecked = previewStats.value.unchecked;
  if (unchecked > 0) {
    showImportConfirm.value = true;
  } else {
    doImport('all');
  }
}

function handleOriginalImport() {
  doImport('original');
}

async function confirmImportAllOk() {
  showImportConfirm.value = false;
  for (const [idx, status] of previewStatuses.value) {
    if (status === 'dont_care') {
      previewStatuses.value.set(idx, 'already_anonymous');
    }
  }
  previewStatuses.value = new Map(previewStatuses.value);
  await doImport('all');
}

async function confirmImportReviewed() {
  showImportConfirm.value = false;
  await doImport('reviewed_only');
}

// === Anonymization Preview ===
function computePreviewStatuses() {
  if (!pendingPreview.value) return;
  const orig = pendingPreview.value.original;
  const anon = pendingPreview.value.anonymized;
  const statuses = new Map<number, string>();
  const matched = new Map<number, number[]>();
  const activeRules = userRules.value.filter((r: any) => ruleToggles.value.has(Number(r.id)));

  for (let i = 0; i < orig.length; i++) {
    const wasChanged = orig[i].booking_text !== anon[i].booking_text;
    const currentStatus = previewStatuses.value.get(i);
    if (currentStatus === 'already_anonymous') {
      statuses.set(i, 'already_anonymous');
    } else {
      statuses.set(i, wasChanged ? 'anonymized' : 'dont_care');
    }

    const matchedIds: number[] = [];
    for (const rule of activeRules) {
      try {
        const regex = new RegExp(rule.pattern, rule.flags || 'gi');
        if (regex.test(orig[i].booking_text)) {
          matchedIds.push(Number(rule.id));
        }
      } catch { /* skip invalid regex */ }
    }
    matched.set(i, matchedIds);
  }
  previewStatuses.value = statuses;
  previewMatchedRules.value = matched;
}

function changePreviewStatus(idx: number, newStatus: string) {
  previewStatuses.value.set(idx, newStatus);
  previewStatuses.value = new Map(previewStatuses.value);
  openPreviewMenuId.value = null;
}

function togglePreviewMenu(idx: number) {
  openPreviewMenuId.value = openPreviewMenuId.value === idx ? null : idx;
}

function closePreviewMenu() {
  openPreviewMenuId.value = null;
}

function getRuleNamesForRow(matchedIds: number[]): string[] {
  return matchedIds.map(id => {
    const rule = userRules.value.find((r: any) => Number(r.id) === id);
    return rule?.name || `Regel #${id}`;
  });
}

async function showAnonymizationPreview() {
  if (!pendingPreview.value) return;

  busy.value = true;
  try {
    if (ruleToggles.value.size === 0 && userRules.value.length > 0) {
      ruleToggles.value = new Set(userRules.value.map((r: any) => Number(r.id)));
    }

    const activeRules = userRules.value.filter((r: any) => ruleToggles.value.has(Number(r.id)));
    const { data: anonymized } = await applyAnonymization(
      pendingPreview.value.original,
      activeRules
    );

    pendingPreview.value.anonymized = anonymized;
    computePreviewStatuses();
  } finally {
    busy.value = false;
  }
}

async function doImport(mode: 'all' | 'reviewed_only' | 'original') {
  if (!pendingPreview.value || !pending.value || !pendingAlias.value) return;

  busy.value = true;
  try {
    let data: any[];
    if (mode === 'original') {
      data = pendingPreview.value.original;
    } else if (mode === 'reviewed_only') {
      data = pendingPreview.value.anonymized.filter((_: any, idx: number) => {
        const status = previewStatuses.value.get(idx);
        return status === 'anonymized' || status === 'already_anonymous';
      });
    } else {
      data = pendingPreview.value.anonymized;
    }

    if (data.length === 0) {
      notify('⚠️ Keine Transaktionen zum Importieren.', 'error');
      busy.value = false;
      return;
    }

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

    notify(`✅ ${up.inserted} Transaktionen gespeichert!`, 'success');

    // Reset state
    pending.value = null;
    pendingAlias.value = '';
    pendingPreview.value = null;
    previewStatuses.value = new Map();
    previewMatchedRules.value = new Map();
    previewFilter.value = 'all';
    hideReviewed.value = false;
  } catch (e: any) {
    console.error("Upload error:", e);
    notify("⚠️ Fehler beim Speichern der Transaktionen.", 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.shell {
  max-width: 100%;
  height: 100vh;
  height: 100dvh;
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

.content-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #eee;
  border-radius: 12px;
  background: #fff;
  flex: 1;
  min-height: 0;
}

.preview-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.import-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
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
  min-height: 0;
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

/* Notification Banner */
.notification-banner {
  padding: 12px 16px;
  margin: 0 16px 12px;
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.3s;
}

.notification-banner.success {
  background: #e8f5e9;
  color: #2e7d32;
}

.notification-banner.error {
  background: #ffebee;
  color: #c62828;
}

.notification-banner.info {
  background: #e3f2fd;
  color: #1565c0;
}

/* Action Bar */
.action-bar {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  flex-shrink: 0;
  justify-content: flex-end;
  border-top: 1px solid #eee;
}

.action-bar-btn {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  font-size: 14px;
  color: #666;
  cursor: pointer;
  transition: all 0.2s;
}

.action-bar-btn:hover {
  background: #f5f5f5;
  border-color: #bbb;
}

.action-bar-btn.primary {
  background: #1976d2;
  color: #fff;
  border-color: #1976d2;
}

.action-bar-btn.primary:hover {
  background: #1565c0;
  border-color: #1565c0;
}

/* Modal Overlay */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  padding: 16px;
}

.modal-content {
  background: white;
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  min-width: 300px;
  max-width: 90%;
  text-align: center;
}

.modal-content h3 {
  margin-top: 0;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 20px;
  flex-wrap: wrap;
}

.modal-btn {
  padding: 10px 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.modal-btn:hover {
  background: #f5f5f5;
  border-color: #bbb;
}

.modal-btn.primary {
  background: #1976d2;
  color: #fff;
  border-color: #1976d2;
}

.modal-btn.primary:hover {
  background: #1565c0;
  border-color: #1565c0;
}

.modal-btn.cancel {
  color: #c62828;
  border-color: #e57373;
}

.modal-btn.cancel:hover {
  background: #ffebee;
  border-color: #e57373;
}

/* Alias Modal */
.alias-buttons {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.alias-form {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  margin-bottom: 16px;
}

.alias-input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  box-sizing: border-box;
}

/* Preview Stats */
.preview-stats-line {
  display: flex;
  gap: 8px;
  align-items: center;
}

.stat-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}

.stat-anon {
  background: #e8f5e9;
  color: #2e7d32;
}

.stat-ok {
  background: #e3f2fd;
  color: #1565c0;
}

.stat-unchecked {
  background: #f5f5f5;
  color: #757575;
}

/* Filter Bar */
.preview-filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #eee;
  gap: 12px;
  flex-shrink: 0;
}

.filter-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.mark-all-ok {
  background: #e3f2fd !important;
  color: #1565c0 !important;
  border-color: #1565c0 !important;
  font-weight: 500;
}

.mark-all-ok:hover {
  background: #1976d2 !important;
  color: #fff !important;
}

.selection-button {
  position: fixed;
  padding: 8px 14px;
  background: #1976d2;
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
  background: #1565c0;
  transform: translate(-50%, -120%) translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.filter-pill {
  padding: 4px 12px;
  border: 1px solid #ddd;
  border-radius: 16px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-pill:hover {
  background: #f5f5f5;
}

.filter-pill.active {
  background: #1a73e8;
  color: #fff;
  border-color: #1a73e8;
}

.hide-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #666;
  white-space: nowrap;
  cursor: pointer;
}

/* Rule Badges */
.rule-badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #e8f5e9;
  color: #2e7d32;
  cursor: default;
  white-space: nowrap;
}

.rule-badge.empty {
  background: #f5f5f5;
  color: #999;
}

/* Action Column */
.action-col {
  width: 48px;
  text-align: center;
}

.amount-col {
  text-align: right;
  font-family: monospace;
}

.text-col {
  white-space: normal;
  word-break: break-word;
}

.type-col {
  white-space: nowrap;
}

.action-button {
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: all 0.2s;
}

.action-button:hover {
  background: #f5f5f5;
  border-color: #bbb;
}

/* Action Menu */
.action-menu {
  position: relative;
}

.menu-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 99;
}

.menu-dropdown {
  position: absolute;
  right: 0;
  top: 100%;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  z-index: 100;
  min-width: 180px;
  padding: 4px 0;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: none;
  text-align: left;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.menu-item:hover:not(:disabled) {
  background: #f5f5f5;
}

.menu-item:disabled {
  color: #ccc;
  cursor: default;
}

/* Completed Row */
.tx-table tr.completed {
  background: #f8fdf8;
}

.tx-table tr.completed td {
  color: #666;
}

/* ======= Responsive: Medium ≤900px ======= */
@media (max-width: 900px) {

  .tx-table th.date-col,
  .tx-table td.date-col,
  .tx-table th.type-col,
  .tx-table td.type-col,
  .tx-table th.amount-col,
  .tx-table td.amount-col {
    display: none;
  }
}

/* ======= Responsive: Mobile ≤600px ======= */
@media (max-width: 600px) {
  .shell {
    padding: 8px;
    gap: 8px;
  }

  .brand {
    font-size: 16px;
  }

  .sub {
    font-size: 12px;
  }

  .view-tabs {
    gap: 4px;
  }

  .view-tab {
    padding: 6px 12px;
    font-size: 13px;
  }

  /* Preview header */
  .preview-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
  }

  .preview-title {
    font-size: 14px;
  }

  .preview-stats-line {
    flex-wrap: wrap;
  }

  /* Filter bar */
  .preview-filter-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
  }

  .filter-pills {
    flex-wrap: wrap;
  }

  /* Table - hide columns, show booking_text multi-line */
  .tx-table {
    font-size: 13px;
  }

  .tx-table th,
  .tx-table td {
    padding: 6px 8px;
  }

  /* Hide all columns except booking_text and action */
  .tx-table th.date-col,
  .tx-table td.date-col,
  .tx-table th.rules-col,
  .tx-table td.rules-col,
  .tx-table th.type-col,
  .tx-table td.type-col,
  .tx-table th.amount-col,
  .tx-table td.amount-col {
    display: none;
  }

  /* Also hide status column header on mobile */
  .tx-table th.status-col,
  .tx-table td.status-col {
    display: none;
  }

  /* Make booking text wrap */
  .text-col {
    max-width: none !important;
    white-space: normal !important;
    word-break: break-word;
  }

  /* Action bar stacks vertically */
  .action-bar {
    flex-direction: column;
    padding: 8px 12px;
  }

  .action-bar-btn {
    width: 100%;
    text-align: center;
    padding: 10px;
  }

  /* Table wrapper removes max-height for mobile scroll */
  .table-wrapper {
    max-height: none;
  }

  /* Modal adjustments */
  .modal-content {
    padding: 16px;
    min-width: unset;
    max-width: 100%;
  }

  .modal-actions {
    flex-direction: column;
  }

  .modal-btn {
    width: 100%;
    text-align: center;
  }
}
</style>

<!-- Global reset – must be unscoped so it targets html/body -->
<style>
html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}
</style>
