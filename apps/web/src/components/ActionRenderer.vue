<template>
  <template v-for="(a, idx) in actions" :key="idx">
    <button
      v-if="a.type === 'button'"
      class="action"
      type="button"
      @click="$emit('action', a.value)"
    >
      {{ a.label }}
    </button>

    <label v-else-if="a.type === 'date'" class="field">
      <span class="label">{{ a.label }}</span>
      <input class="control" type="date" @change="$emit('action', ($event.target as HTMLInputElement).value)" />
    </label>

    <label v-else-if="a.type === 'text'" class="field">
      <span class="label">{{ a.label }}</span>
      <input class="control" type="text" :placeholder="a.placeholder" @keydown.enter.prevent="$emit('action', ($event.target as HTMLInputElement).value)" />
    </label>

    <label v-else-if="a.type === 'file'" class="field">
      <span class="label">{{ a.label }}</span>
      <input class="control" type="file" :accept="a.accept" />
    </label>
  </template>
</template>

<script setup lang="ts">
import type { Action } from "../types";
defineProps<{ actions: Action[] }>();
defineEmits<{ (e: "action", value: string): void }>();
</script>

<style scoped>
.action { padding: 10px 12px; border-radius: 12px; border: 1px solid #ddd; background: #fff; font-size: 13px; }
.field { display: grid; gap: 6px; min-width: 200px; }
.label { font-size: 12px; opacity: 0.7; }
.control { padding: 10px 12px; border-radius: 12px; border: 1px solid #ddd; }
</style>
