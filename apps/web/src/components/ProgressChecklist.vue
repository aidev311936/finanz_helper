<template>
    <div class="progress-checklist">
        <!-- Progress Bar -->
        <div class="progress-header">
            <span class="progress-label">Fortschritt</span>
            <div class="progress-bar">
                <div class="progress-fill" :style="{ width: progress.percentage + '%' }"></div>
            </div>
            <span class="progress-text">{{ progress.current }}/{{ progress.total }}</span>
        </div>

        <!-- Checklist -->
        <div class="checklist">
            <div v-for="step in steps" :key="step.id" class="step-item" :class="{ completed: step.completed }">
                <span class="step-checkbox">{{ step.completed ? '✓' : '○' }}</span>
                <span class="step-label">{{ step.label }}</span>
                <span v-if="step.meta" class="step-meta">({{ step.meta }})</span>

                <button v-if="step.editable && step.completed" class="btn-edit" @click="$emit('change-alias')">
                    Ändern
                </button>

                <!-- Child rules -->
                <div v-if="step.children" class="step-children">
                    <div v-for="child in step.children" :key="child.id" class="child-item"
                        :class="{ inactive: !child.active }">
                        <span class="child-checkbox">{{ child.active ? '✓' : '✗' }}</span>
                        <span class="child-label">{{ child.label }}</span>

                        <!-- Inline action buttons -->
                        <div class="child-actions">
                            <button class="action-btn toggle-btn" :class="{ active: child.active }"
                                @click="handleAction('toggle', child.id)"
                                :title="child.active ? 'Deaktivieren' : 'Aktivieren'">
                                {{ child.active ? '✗' : '✓' }}
                            </button>
                            <button class="action-btn delete-btn" @click="handleAction('delete', child.id)"
                                title="Löschen">
                                🗑
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
    steps: any[];
    currentStep: { current: number; total: number; percentage: number };
    accountAlias: string;
    rules: any[];
    activeRules: Set<number>;
}>();

const emit = defineEmits<{
    (e: 'change-alias'): void;
    (e: 'rule-context', action: string, ruleId: number): void;
}>();

const progress = computed(() => props.currentStep);

function handleAction(action: string, ruleId: number) {
    emit('rule-context', action, ruleId);
}
</script>

<style scoped>
.progress-checklist {
    background: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    font-size: 13px;
}

.progress-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
}

.progress-label {
    font-weight: 600;
    color: #666;
    font-size: 12px;
}

.progress-bar {
    flex: 1;
    height: 8px;
    background: #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4caf50, #66bb6a);
    transition: width 0.3s;
}

.progress-text {
    font-weight: 600;
    color: #666;
    font-size: 12px;
}

.checklist {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.step-item {
    display: flex;
    align-items: center;
    gap: 6px;
}

.step-item.completed .step-label {
    color: #4caf50;
    font-weight: 500;
}

.step-checkbox {
    width: 16px;
    text-align: center;
    font-weight: bold;
}

.step-label {
    flex: 1;
}

.step-meta {
    color: #999;
    font-size: 12px;
}

.btn-edit {
    margin-left: auto;
    padding: 3px 10px;
    font-size: 11px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-edit:hover {
    background: #f5f5f5;
    border-color: #999;
}

.step-children {
    margin-left: 24px;
    margin-top: 4px;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
}

.child-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    transition: background 0.2s;
}

.child-item:hover {
    background: #f0f0f0;
}

.child-item.inactive {
    opacity: 0.6;
}

.child-item.inactive .child-label {
    text-decoration: line-through;
}

.child-checkbox {
    width: 14px;
    text-align: center;
    font-size: 12px;
}

.child-label {
    font-size: 12px;
    flex: 1;
}

.child-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.2s;
}

.child-item:hover .child-actions {
    opacity: 1;
}

.action-btn {
    padding: 2px 6px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    font-size: 11px;
    transition: all 0.2s;
}

.action-btn:hover {
    background: #f5f5f5;
    border-color: #999;
}

.toggle-btn.active {
    background: #e8f5e9;
    border-color: #4caf50;
    color: #2e7d32;
}

.delete-btn:hover {
    background: #ffebee;
    border-color: #e57373;
    color: #c62828;
}
</style>
