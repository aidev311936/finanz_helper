<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Neue Anonymisierungsregel</h3>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <!-- Step 1: Example text -->
        <div class="field">
          <label>Was soll ersetzt werden?</label>
          <input
            v-model="example"
            class="field-input"
            placeholder="z.B. DE12345678901234567890"
            autofocus
          />
          <span class="field-hint">Text aus dem Buchungstext, der anonymisiert werden soll</span>
        </div>

        <!-- Step 2: Replacement -->
        <div class="field">
          <label>Ersetzen durch:</label>
          <input
            v-model="replacement"
            class="field-input"
            placeholder="z.B. [IBAN]"
          />
        </div>

        <!-- Step 3: Generated pattern preview -->
        <div v-if="example" class="field">
          <label>Erkanntes Pattern:</label>
          <code class="pattern-preview">{{ generatedPattern }}</code>
        </div>

        <!-- Step 4: Rule name -->
        <div class="field">
          <label>Name der Regel:</label>
          <input
            v-model="ruleName"
            class="field-input"
            placeholder="z.B. IBAN Maskierung"
          />
          <div class="name-suggestions">
            <button
              v-for="suggestion in nameSuggestions"
              :key="suggestion"
              class="suggestion-btn"
              @click="ruleName = suggestion"
            >{{ suggestion }}</button>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="modal-btn cancel" @click="$emit('close')">Abbrechen</button>
        <button
          class="modal-btn primary"
          :disabled="!canCreate"
          @click="createRule"
        >Regel erstellen</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const props = defineProps<{
  initialExample?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'create', data: { name: string; pattern: string; replacement: string }): void;
}>();

const example = ref(props.initialExample || '');
const replacement = ref('');
const ruleName = ref('');

const generatedPattern = computed(() => {
  if (!example.value) return '';
  return generatePattern(example.value);
});

const nameSuggestions = computed(() => {
  const suggestions = ['IBAN Maskierung', 'Bankdaten', 'Kontonummer', 'Name/Adresse'];
  if (example.value && replacement.value) {
    suggestions.unshift(`"${example.value.substring(0, 20)}" → "${replacement.value}"`);
  }
  return suggestions;
});

const canCreate = computed(() =>
  example.value.trim() && replacement.value.trim() && ruleName.value.trim()
);

function generatePattern(ex: string): string {
  if (/^DE\d{20}$/.test(ex)) return 'DE\\d{20}';
  if (/^[A-Z]{2}\d{2}[\w\s]{1,30}$/.test(ex)) return '[A-Z]{2}\\d{2}[\\w\\s]{1,30}';
  if (/^\w+@\w+\.\w+$/.test(ex)) return '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}';
  if (/^\d+$/.test(ex)) return '\\d{' + ex.length + ',}';
  return ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createRule() {
  if (!canCreate.value) return;
  emit('create', {
    name: ruleName.value.trim(),
    pattern: generatedPattern.value,
    replacement: replacement.value.trim(),
  });
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.modal-content {
  background: white;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.close-btn {
  border: none;
  background: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
  padding: 4px;
}

.close-btn:hover {
  color: #333;
}

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #333;
  margin-bottom: 6px;
}

.field-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
}

.field-input:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.field-hint {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
  display: block;
}

.pattern-preview {
  display: block;
  padding: 8px 12px;
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 13px;
  word-break: break-all;
}

.name-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.suggestion-btn {
  padding: 4px 10px;
  border: 1px solid #ddd;
  border-radius: 12px;
  background: #f9f9f9;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.suggestion-btn:hover {
  background: #e3f2fd;
  border-color: #1976d2;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid #eee;
}

.modal-btn {
  padding: 10px 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.modal-btn:hover {
  background: #f5f5f5;
}

.modal-btn.primary {
  background: #1976d2;
  color: white;
  border-color: #1976d2;
}

.modal-btn.primary:hover {
  background: #1565c0;
}

.modal-btn.primary:disabled {
  background: #ccc;
  border-color: #ccc;
  cursor: not-allowed;
}

.modal-btn.cancel {
  color: #666;
}
</style>
