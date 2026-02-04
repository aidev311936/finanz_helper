<template>
  <div class="rule-badge-container">
    <div 
      v-if="appliedRules.length > 0" 
      class="rule-badge"
      @mouseenter="showTooltip = true"
      @mouseleave="showTooltip = false"
    >
      {{ appliedRules.length }} {{ appliedRules.length === 1 ? 'Regel' : 'Regeln' }}
      
      <div v-if="showTooltip" class="tooltip">
        <div v-for="rule in appliedRules" :key="rule.id" class="tooltip-item">
          {{ rule.name }}
        </div>
      </div>
    </div>
    <div v-else class="rule-badge empty">
      Keine Regeln
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  ruleIds: number[];
  allRules: any[];
}>();

const showTooltip = ref(false);

const appliedRules = computed(() => {
  if (!props.ruleIds || !Array.isArray(props.ruleIds)) return [];
  
  return props.ruleIds
    .map(id => props.allRules.find(r => Number(r.id) === Number(id)))
    .filter(Boolean);
});
</script>

<style scoped>
.rule-badge-container {
  display: inline-block;
}

.rule-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 12px;
  background: #e3f2fd;
  color: #1976d2;
  font-size: 12px;
  font-weight: 500;
  position: relative;
  cursor: help;
  white-space: nowrap;
  transition: background 0.2s;
}

.rule-badge:hover {
  background: #bbdefb;
}

.rule-badge.empty {
  background: #f5f5f5;
  color: #999;
  cursor: default;
}

.rule-badge.empty:hover {
  background: #f5f5f5;
}

.tooltip {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 6px;
  padding: 8px 12px;
  background: #333;
  color: white;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  z-index: 1000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.tooltip::before {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-bottom-color: #333;
}

.tooltip-item {
  padding: 2px 0;
}

.tooltip-item + .tooltip-item {
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  margin-top: 4px;
  padding-top: 4px;
}
</style>
