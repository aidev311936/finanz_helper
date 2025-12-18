<template>
  <div class="max-w-xl mx-auto bg-white p-6 rounded-lg shadow">
    <h2 class="text-lg font-semibold mb-4">Schritt&nbsp;2: Ausgabenanalyse (Basis)</h2>
    <p class="mb-4">Dies ist eine einfache Übersicht über deine importierten Umsätze. Später werden hier weitere Analysen und Kategorisierungen folgen.</p>
    <div v-if="loading" class="mb-2 text-sm">Daten werden geladen…</div>
    <div v-if="error" class="mb-2 text-sm text-red-600">{{ error }}</div>
    <div v-if="!loading && !error">
      <div class="mb-2">Summe Einnahmen: <strong>{{ summary.income_sum }}</strong></div>
      <div class="mb-2">Summe Ausgaben: <strong>{{ summary.expense_sum }}</strong></div>
      <div class="mb-2">Saldo: <strong>{{ summary.net }}</strong></div>
      <div class="mb-4">Anzahl Transaktionen: <strong>{{ summary.transaction_count }}</strong></div>
      <button @click="goBack" class="px-4 py-2 bg-blue-600 text-white rounded">Zurück zum Import</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const loading = ref(false);
const error = ref('');
const summary = ref({ income_sum: 0, expense_sum: 0, net: 0, transaction_count: 0 });

function goBack() {
  router.push('/');
}

async function fetchSummary() {
  loading.value = true;
  try {
    // Token und Workspace aus localStorage laden
    const token = localStorage.getItem('finanz_helper_token');
    const workspace = localStorage.getItem('finanz_helper_workspace');
    let query = '';
    if (workspace) {
      query = `?workspace_id=${encodeURIComponent(workspace)}`;
    } else if (token) {
      query = `?token=${encodeURIComponent(token)}`;
    }
    const res = await fetch(`${import.meta.env.VITE_BACKEND_BASE_URL || ''}/api/analysis/summary${query}`);
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Analyse fehlgeschlagen');
    }
    summary.value = json;
  } catch (e) {
    console.error(e);
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  fetchSummary();
});
</script>

<style scoped>
.shadow {
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.rounded-lg {
  border-radius: 0.5rem;
}
.mb-4 {
  margin-bottom: 1rem;
}
.px-4 {
  padding-left: 1rem;
  padding-right: 1rem;
}
.py-2 {
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
}
.bg-blue-600 {
  background-color: #2563eb;
}
.text-white {
  color: white;
}
.rounded {
  border-radius: 0.25rem;
}
</style>
