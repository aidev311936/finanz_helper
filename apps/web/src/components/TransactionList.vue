<template>
    <div class="transaction-list">
        <div class="list-header">
            <h3>Gespeicherte Transaktionen</h3>
            <div class="stats">{{ transactions.length }} Transaktionen</div>
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
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="tx in transactions" :key="tx.id">
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
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchMaskedTransactions, fetchAnonRules } from '../api';
import StatusBadge from './StatusBadge.vue';
import RuleBadge from './RuleBadge.vue';

const transactions = ref<any[]>([]);
const rules = ref<any[]>([]);
const loading = ref(true);
const error = ref('');

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
</style>
