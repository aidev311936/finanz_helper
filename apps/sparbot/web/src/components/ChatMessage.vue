<template>
  <div class="chat-message" :class="[`chat-message--${role}`, { 'chat-message--latest': isLatest }]">
    <!-- Avatar -->
    <div class="chat-message__avatar">
      <span v-if="role === 'assistant'" class="avatar avatar--bot">🤖</span>
      <span v-else class="avatar avatar--user">👤</span>
    </div>

    <!-- Content -->
    <div class="chat-message__body">
      <template v-for="(block, i) in blocks" :key="i">
        <!-- Text block -->
        <div v-if="block.type === 'text'" class="chat-message__text" v-html="formatText(block.text)" />

        <!-- Table block -->
        <TransactionTable
          v-else-if="block.type === 'table'"
          :columns="block.columns"
          :rows="block.rows"
          :caption="block.caption"
        />

        <!-- Actions block -->
        <ActionButtons
          v-else-if="block.type === 'actions'"
          :buttons="block.buttons"
          :disabled="!isLatest"
          @select="$emit('action', $event)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContentBlock } from "../types";
import TransactionTable from "./TransactionTable.vue";
import ActionButtons from "./ActionButtons.vue";

const props = defineProps<{
  role: "user" | "assistant";
  content: ContentBlock[] | string;
  isLatest?: boolean;
}>();

defineEmits<{
  (e: "action", value: string): void;
}>();

// Normalise content to always be an array of blocks
const blocks = computed<ContentBlock[]>(() => {
  const c = props.content;
  if (typeof c === "string") {
    return [{ type: "text", text: c }];
  }
  if (Array.isArray(c)) return c;
  return [{ type: "text", text: String(c) }];
});

/**
 * Convert plain text to basic HTML:
 * - escape HTML entities
 * - convert newlines to <br>
 * - bold text between **
 */
function formatText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

import { computed } from "vue";
</script>

<style scoped>
.chat-message {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-lg) 0;
  animation: message-in 0.3s ease both;
}

@keyframes message-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Avatar */
.chat-message__avatar {
  flex-shrink: 0;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  font-size: 1.1rem;
}

.avatar--bot {
  background: var(--color-accent-subtle);
}

.avatar--user {
  background: var(--color-bg-elevated);
}

/* Body */
.chat-message__body {
  flex: 1;
  min-width: 0;
}

.chat-message__text {
  color: var(--color-text);
  line-height: var(--line-height);
  word-wrap: break-word;
}

/* User messages get a subtle bubble */
.chat-message--user .chat-message__body {
  background: var(--color-bg-elevated);
  border-radius: var(--radius-md);
  padding: var(--space-md) var(--space-lg);
}

/* Assistant messages: no bubble, just text */
.chat-message--assistant .chat-message__text {
  padding: var(--space-xs) 0;
}
</style>
