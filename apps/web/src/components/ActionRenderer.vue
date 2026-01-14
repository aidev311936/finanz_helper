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

      <button
        v-else-if="a.type==='toggle'"
        class="chip toggle"
        :class="{ active: a.active }"
        @click="$emit('action', a.value)"
      >
        {{ a.active ? '✓' : '○' }} {{ a.label }}
      </button>

      <div v-else-if="a.type==='table'" class="tableWrap">
        <table class="table" v-if="a.rows && a.rows.length">
          <thead>
            <tr>
              <th v-for="k in Object.keys(a.rows[0])" :key="k">{{ k }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, ridx) in a.rows" :key="ridx">
              <td
                v-for="k in Object.keys(a.rows[0])"
                :key="k"
                :class="cellClass(k, r[k])"
              >
                {{ formatCell(k, r[k]) }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="muted">(keine Daten)</div>
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

function isNumber(v: any) {
  return typeof v === "number" && Number.isFinite(v);
}

function formatCell(key: string, value: any) {
  if (isNumber(value)) {
    const k = String(key || "");
    const n = Number(value);
    const fixed = Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2);
    // Add € only if the column implies currency.
    if (k.includes("€") || /betrag|summe|limit|ausgegeben|übrig/i.test(k)) {
      return `${fixed} €`;
    }
    return fixed;
  }
  return value;
}

function cellClass(key: string, value: any) {
  const k = String(key || "");
  if (isNumber(value) || k.includes("€") || /betrag|summe|limit|ausgegeben|übrig/i.test(k)) return "num";
  return "";
}

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
.tableWrap { width:100%; overflow:auto; border:1px solid #eee; border-radius:12px; }
.table { border-collapse:collapse; width:100%; min-width:520px; }
.table th, .table td { padding:10px 12px; border-bottom:1px solid #eee; text-align:left; font-size:13px; }
.table td.num, .table th.num { text-align:right; white-space:nowrap; }
.muted { opacity:0.7; padding:10px 12px; }
.chip.toggle { transition: all 0.2s; cursor: pointer; }
.chip.toggle.active { background: #1a73e8; color: #fff; border-color: #1a73e8; }
</style>
