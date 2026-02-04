<template>
    <div class="transaction-list">
        <div class="list-header">
            <h3>Gespeicherte Transaktionen</h3>
            <div class="stats">{{ filteredTransactions.length }} / {{ transactions.length }} Transaktionen</div>
        </div>

        <div class="filter-bar">
            <div class="status-filters">
                <button class="filter-pill" :class="{ active: activeFilter === 'all' }" @click="activeFilter = 'all'">
                    Alle
                </button>
                <button class="filter-pill" :class="{ active: activeFilter === 'anonymized' }"
                    @click="activeFilter = 'anonymized'">
                    ✓ Anonymisiert
                </button>
                <button class="filter-pill" :class="{ active: activeFilter === 'already_anonymous' }"
                    @click="activeFilter = 'already_anonymous'">
                    ◉ Bereits anonym
                </button>
                <button class="filter-pill" :class="{ active: activeFilter === 'dont_care' }"
                    @click="activeFilter = 'dont_care'">
                    ○ Keine Aktion
                </button>
            </div>
            <label class="hide-toggle">
                <input type="checkbox" v-model="hideCompleted" />
                Fertige Umsätze ausblenden
            </label>
        </div>

        <div v-if="loading" class="loading">Lade Transaktionen...</div>
        <div v-else-if="error" class="error">{{ error }}</div>
        <div v-else-if="transactions.length === 0" class="empty">
            <p>Keine Transaktionen gefunden</p>
            <p class="hint">Importiere zuerst CSV-Dateien, um Transaktionen zu speichern.</p>
        </div>
        <div v-else class="table-wrapper">
            <table class="tx-table">
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Datum</th>
                        <th>Buchungstext</th>
                        <th>Regeln</th>
                        <th>Typ</th>
                        <th class="amount-col">Betrag</th>
                        <th class="action-col">Aktion</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="tx in filteredTransactions" :key="tx.id"
                        :class="{ 'completed': tx.anonymity_status === 'already_anonymous' }">
                        <td>
                            <StatusBadge :status="tx.anonymity_status" />
                        </td>
                        <td class="date-col">{{ formatDate(tx.booking_date_iso) }}</td>
                        <td class="text-col">{{ tx.booking_text }}</td>
                        <td>
                            <RuleBadge :rule-ids="tx.applied_rules || []" :all-rules="rules" />
                        </td>
                        <td class="type-col">{{ tx.booking_type || '-' }}</td>
                        <td class="amount-col">{{ tx.booking_amount || '-' }}</td>
                        <td class="action-col">
                            <div class="action-menu" v-if="openMenuId === tx.id" @click.stop>
                                <div class="menu-backdrop" @click="closeMenu"></div>
                                <div class="menu-dropdown">
                                    <button class="menu-item" @click="changeStatus(tx.id, 'already_anonymous')"
                                        :disabled="tx.anonymity_status === 'already_anonymous'">
                                        ◉ Als anonym markieren
                                    </button>
                                    <button class="menu-item" @click="changeStatus(tx.id, 'dont_care')"
                                        :disabled="tx.anonymity_status === 'dont_care'">
                                        ○ Status zurücksetzen
                                    </button>
                                </div>
                            </div>
                            <button class="action-button" @click.stop="toggleMenu(tx.id)">
                                ⋮
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { fetchMaskedTransactions, fetchAnonRules, updateTransactionStatus } from '../api';
import StatusBadge from './StatusBadge.vue';
import RuleBadge from './RuleBadge.vue';

const transactions = ref<any[]>([]);
const rules = ref<any[]>([]);
const loading = ref(true);
const error = ref('');
const openMenuId = ref<number | null>(null);
const updating = ref<number | null>(null);
const hideCompleted = ref(false);
const activeFilter = ref<'all' | 'anonymized' | 'already_anonymous' | 'dont_care'>('all');

onMounted(async () => {
    try {
        loading.value = true;
        error.value = '';

        const [txData, ruleData] = await Promise.all([
            fetchMaskedTransactions(),
            fetchAnonRules()
        ]);

        transactions.value = txData;
        rules.value = ruleData;
    } catch (e: any) {
        console.error('Failed to load transactions:', e);
        error.value = 'Fehler beim Laden der Transaktionen';
    } finally {
        loading.value = false;
    }
});

function formatDate(iso: string | null) {
    if (!iso) return 'N/A';
    try {
        return new Date(iso).toLocaleDateString('de-DE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    } catch {
        return 'N/A';
    }
}

const filteredTransactions = computed(() => {
    let result = transactions.value;

    // Apply status filter
    if (activeFilter.value !== 'all') {
        result = result.filter(tx => tx.anonymity_status === activeFilter.value);
    }

    // Apply hide completed filter
    if (hideCompleted.value) {
        result = result.filter(tx => tx.anonymity_status !== 'already_anonymous');
    }

    return result;
});

function toggleMenu(txId: number) {
    if (openMenuId.value === txId) {
        openMenuId.value = null;
    } else {
        openMenuId.value = txId;
    }
}

function closeMenu() {
    openMenuId.value = null;
}

async function changeStatus(txId: number, newStatus: 'dont_care' | 'anonymized' | 'already_anonymous') {
    if (updating.value === txId) return;

    const tx = transactions.value.find(t => t.id === txId);

    // Readonly protection: prevent changing status of already_anonymous transactions
    if (tx && tx.anonymity_status === 'already_anonymous' && newStatus !== 'dont_care') {
        return; // Silently ignore
    }

    try {
        updating.value = txId;
        closeMenu();

        // Optimistic update
        const tx = transactions.value.find(t => t.id === txId);
        if (tx) {
            const oldStatus = tx.anonymity_status;
            tx.anonymity_status = newStatus;

            try {
                await updateTransactionStatus(txId, newStatus);
            } catch (e) {
                // Revert on error
                tx.anonymity_status = oldStatus;
                console.error('Failed to update status:', e);
                error.value = 'Fehler beim Aktualisieren des Status';
                setTimeout(() => error.value = '', 3000);
            }
        }
    } finally {
        updating.value = null;
    }
}
</script>

<style scoped>
.transaction-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: white;
    border-radius: 12px;
    border: 1px solid #eee;
}

.list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #eee;
    flex-shrink: 0;
}

.list-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
}

.stats {
    font-size: 14px;
    color: #666;
}

.filter-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-bottom: 1px solid #eee;
    background: #fafafa;
    flex-shrink: 0;
}

.status-filters {
    display: flex;
    gap: 8px;
}

.filter-pill {
    padding: 6px 12px;
    border: 1px solid #ddd;
    border-radius: 16px;
    background: white;
    font-size: 13px;
    color: #666;
    cursor: pointer;
    transition: all 0.2s;
}

.filter-pill:hover {
    background: #f0f0f0;
    border-color: #bbb;
}

.filter-pill.active {
    background: #1976d2;
    color: white;
    border-color: #1976d2;
    font-weight: 500;
}

.hide-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #666;
    cursor: pointer;
    user-select: none;
}

.hide-toggle input[type="checkbox"] {
    cursor: pointer;
}

.loading,
.error,
.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 40px;
    text-align: center;
}

.error {
    color: #d32f2f;
}

.empty p {
    margin: 8px 0;
}

.empty .hint {
    color: #999;
    font-size: 14px;
}

.table-wrapper {
    flex: 1;
    overflow-y: auto;
}

.tx-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}

.tx-table thead {
    position: sticky;
    top: 0;
    background: #fafafa;
    z-index: 10;
}

.tx-table th {
    padding: 12px 16px;
    text-align: left;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    color: #666;
    border-bottom: 2px solid #e0e0e0;
}

.tx-table tbody tr {
    border-bottom: 1px solid #f0f0f0;
    transition: background 0.15s;
}

.tx-table tbody tr:hover {
    background: #fafafa;
}

.tx-table tbody tr.completed {
    opacity: 0.6;
}

.tx-table tbody tr.completed:hover {
    opacity: 0.8;
}

.tx-table td {
    padding: 12px 16px;
    vertical-align: middle;
}

.date-col {
    white-space: nowrap;
    color: #666;
}

.text-col {
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.type-col {
    color: #666;
    font-size: 12px;
}

.amount-col {
    text-align: right;
    font-weight: 500;
    white-space: nowrap;
}

.action-col {
    width: 60px;
    text-align: center;
    position: relative;
}

.action-button {
    padding: 4px 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    font-size: 16px;
    color: #666;
    transition: all 0.2s;
}

.action-button:hover {
    background: #f5f5f5;
    border-color: #bbb;
}

.action-menu {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1000;
}

.menu-backdrop {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: transparent;
}

.menu-dropdown {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    min-width: 200px;
    overflow: hidden;
}

.menu-item {
    display: block;
    width: 100%;
    padding: 12px 16px;
    border: none;
    background: white;
    text-align: left;
    cursor: pointer;
    font-size: 14px;
    color: #333;
    transition: background 0.15s;
    border-bottom: 1px solid #f0f0f0;
}

.menu-item:last-child {
    border-bottom: none;
}

.menu-item:hover:not(:disabled) {
    background: #f5f5f5;
}

.menu-item:disabled {
    color: #999;
    cursor: not-allowed;
    background: #fafafa;
}
</style>
