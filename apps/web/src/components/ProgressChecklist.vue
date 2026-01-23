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
                        :class="{ inactive: !child.active }" @contextmenu.prevent="showContextMenu($event, child.id)">
                        <span class="child-checkbox">{{ child.active ? '✓' : '✗' }}</span>
                        <span class="child-label">{{ child.label }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Context Menu -->
        <div v-if="contextMenu" class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
            @click.stop>
            <div class="menu-item" @click="handleAction('toggle', contextMenu.ruleId)">
                {{ isActive(contextMenu.ruleId) ? '✗ Deaktivieren' : '✓ Aktivieren' }}
            </div>
            <div class="menu-item" @click="handleAction('edit', contextMenu.ruleId)">
                ✏ Ändern
            </div>
            <div class="menu-item danger" @click="handleAction('delete', contextMenu.ruleId)">
                🗑 Löschen
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

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

const contextMenu = ref<{ ruleId: number; x: number; y: number } | null>(null);

const progress = computed(() => props.currentStep);

function showContextMenu(event: MouseEvent, ruleId: number) {
    contextMenu.value = { ruleId, x: event.clientX, y: event.clientY };
}

function isActive(ruleId: number) {
    return props.activeRules.has(ruleId);
}

function handleAction(action: string, ruleId: number) {
    emit('rule-context', action, ruleId);
    contextMenu.value = null;
}

// Close context menu on click outside
if (typeof window !== 'undefined') {
    window.addEventListener('click', () => {
        contextMenu.value = null;
    });
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
    flex-direction: column;
    gap: 2px;
}

.child-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
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
}

.context-menu {
    position: fixed;
    background: white;
    border: 1px solid #ccc;
    border-radius: 6px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
    z-index: 1001;
    min-width: 180px;
    overflow: hidden;
}

.menu-item {
    padding: 10px 14px;
    cursor: pointer;
    transition: background 0.2s;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.menu-item:hover {
    background: #f5f5f5;
}

.menu-item.danger:hover {
    background: #ffebee;
    color: #c62828;
}
</style>
