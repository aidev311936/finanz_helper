<template>
  <div class="status-badge" :class="statusClass">
    <span class="status-icon">{{ statusIcon }}</span>
    <span class="status-label">{{ statusLabel }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  status: string;
}>();

const statusIcon = computed(() => {
  switch (props.status) {
    case 'anonymized': return '✓';
    case 'already_anonymous': return '◉';
    default: return '○';
  }
});

const statusLabel = computed(() => {
  switch (props.status) {
    case 'anonymized': return 'Anonymisiert';
    case 'already_anonymous': return 'Bereits anonym';
    default: return 'Keine Aktion';
  }
});

const statusClass = computed(() => {
  switch (props.status) {
    case 'anonymized': return 'anonymized';
    case 'already_anonymous': return 'already-anonymous';
    default: return 'dont-care';
  }
});
</script>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.status-badge.anonymized {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-badge.already-anonymous {
  background: #e3f2fd;
  color: #1976d2;
}

.status-badge.dont-care {
  background: #f5f5f5;
  color: #757575;
}

.status-icon {
  font-size: 14px;
}

.status-label {
  font-size: 11px;
}
</style>
