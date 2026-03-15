<template>
  <div class="tx-table">
    <p v-if="caption" class="tx-table__caption">{{ caption }}</p>
    <div class="tx-table__scroll">
      <table>
        <thead>
          <tr>
            <th v-for="col in columns" :key="col">{{ col }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="i">
            <td v-for="(cell, j) in row" :key="j">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  columns: string[];
  rows: string[][];
  caption?: string;
}>();
</script>

<style scoped>
.tx-table {
  margin: var(--space-sm) 0;
}

.tx-table__caption {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: var(--space-xs);
}

.tx-table__scroll {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

thead {
  background: var(--color-bg-elevated);
}

th {
  padding: var(--space-sm) var(--space-md);
  text-align: left;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}

td {
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--color-border-subtle);
}

tr:last-child td {
  border-bottom: none;
}

tr:hover td {
  background: var(--color-bg-hover);
}
</style>
