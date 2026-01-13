<template>
  <div class="actions" v-if="actions && actions.length">
    <template v-for="(a, idx) in actions" :key="idx">
      <button
        v-if="a.type==='button'"
        class="chip"
        @click="$emit('action', a.value)"
      >
        {{ a.label }}
      </button>

      <form v-else-if="a.type==='text'" class="inline" @submit.prevent="submitText(a)">
        <input
          class="text"
          :placeholder="a.placeholder || a.label"
          v-model="textValue"
        />
        <button class="chip" type="submit">{{ a.submitLabel || 'OK' }}</button>
      </form>

      <form v-else-if="a.type==='date'" class="inline" @submit.prevent="submitText(a)">
        <input class="text" type="date" v-model="textValue" />
        <button class="chip" type="submit">OK</button>
      </form>

      <div v-else-if="a.type==='file'" class="inline">
        <label class="chip file">
          {{ a.label }}
          <input type="file" :accept="a.accept" @change="onFile" />
        </label>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { Action } from "../types";

defineProps<{ actions: Action[] }>();
const emit = defineEmits<{
  (e: "action", value: string): void;
  (e: "file", file: File): void;
}>();

const textValue = ref("");

function submitText(_a: Action) {
  const v = textValue.value.trim();
  if (!v) return;
  emit("action", v);
  textValue.value = "";
}

function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) emit("file", f);
  (e.target as HTMLInputElement).value = "";
}
</script>

<style scoped>
.actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; }
.chip { border:1px solid #ddd; background:#fff; border-radius:999px; padding:10px 12px; font-size:14px; }
.inline { display:flex; gap:10px; align-items:center; }
.text { border:1px solid #ddd; border-radius:12px; padding:10px 12px; font-size:14px; min-width:220px; }
.file input { display:none; }
</style>
