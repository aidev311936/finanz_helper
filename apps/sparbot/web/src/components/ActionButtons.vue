<template>
  <div v-if="buttons.length" class="action-buttons">
    <button
      v-for="btn in buttons"
      :key="btn.value"
      class="action-btn"
      :disabled="disabled"
      @click="$emit('select', btn.value)"
    >
      {{ btn.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ActionButton } from "../types";

defineProps<{
  buttons: ActionButton[];
  disabled?: boolean;
}>();

defineEmits<{
  (e: "select", value: string): void;
}>();
</script>

<style scoped>
.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}

.action-btn {
  padding: var(--space-sm) var(--space-lg);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-full);
  color: var(--color-accent);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  background: transparent;
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    transform var(--transition-fast);
}

.action-btn:hover:not(:disabled) {
  background: var(--color-accent);
  color: var(--color-bg);
  transform: translateY(-1px);
}

.action-btn:active:not(:disabled) {
  transform: translateY(0);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
