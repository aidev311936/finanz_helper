<template>
  <div class="max-w-xl mx-auto bg-white p-6 rounded-lg shadow">
    <h2 class="text-lg font-semibold mb-4">Schritt&nbsp;1: CSV‑Import</h2>
    <p class="mb-2">Lade deine Bankumsatz‑CSV hoch. Die Erkennung der Bank und die Anonymisierung laufen im Hintergrund.</p>
    <input type="file" accept=".csv" @change="onFileChange" class="mb-4" />
    <div v-if="uploading" class="mb-2 text-sm">Import läuft…</div>
    <div v-if="error" class="mb-2 text-sm text-red-600">{{ error }}</div>
    <div v-if="success" class="mb-2 text-sm text-green-600">{{ success }}</div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const uploading = ref(false);
const error = ref('');
const success = ref('');

async function onFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  error.value = '';
  success.value = '';
  uploading.value = true;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${import.meta.env.VITE_BACKEND_BASE_URL || ''}/api/import/csv`, {
      method: 'POST',
      body: formData
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Import fehlgeschlagen');
    }
    // Speichere Token und Workspace, damit spätere API‑Aufrufe sie verwenden können
    if (json.token) {
      localStorage.setItem('finanz_helper_token', json.token);
    }
    if (json.workspace_id) {
      localStorage.setItem('finanz_helper_workspace', json.workspace_id);
    }
    success.value = `Import abgeschlossen (\${json.count} Buchungen). Du kannst zur Analyse fortfahren.`;
    // Kurze Verzögerung, dann zur Analyse
    setTimeout(() => {
      router.push('/analysis');
    }, 800);
  } catch (e) {
    console.error(e);
    error.value = e.message;
  } finally {
    uploading.value = false;
  }
}
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
</style>