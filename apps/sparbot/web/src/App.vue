<template>
  <div class="app">
    <!-- Header -->
    <header class="app-header">
      <div class="app-header__brand">
        <span class="app-header__icon">🤖</span>
        <h1 class="app-header__title">Sparbot</h1>
      </div>
      <span v-if="profile" class="app-header__user">{{ profile.display_name }}</span>
    </header>

    <!-- Chat area -->
    <main class="chat-area" ref="chatAreaRef">
      <!-- Messages -->
      <template v-if="messages.length">
        <ChatMessage
          v-for="(msg, i) in messages"
          :key="msg.id ?? i"
          :role="msg.role"
          :content="msg.content"
          :is-latest="i === messages.length - 1 && msg.role === 'assistant'"
          @action="handleAction"
        />
      </template>

      <!-- Onboarding: Step 1 — Ansprache -->
      <template v-else-if="!profile && onboardStep === 'formality'">
        <ChatMessage
          role="assistant"
          :content="onboardFormalityBlocks"
          :is-latest="true"
          @action="handleFormalityChoice"
        />
      </template>

      <!-- Onboarding: Step 2 — Name -->
      <template v-else-if="!profile && onboardStep === 'name'">
        <ChatMessage
          role="assistant"
          :content="onboardFormalityBlocks"
          :is-latest="false"
        />
        <ChatMessage
          role="user"
          :content="[{ type: 'text', text: chosenFormality === 'du' ? 'Du' : 'Sie' }]"
          :is-latest="false"
        />
        <ChatMessage
          role="assistant"
          :content="onboardNameBlocks"
          :is-latest="true"
        />
      </template>

      <!-- Loading -->
      <div v-if="loading" class="chat-typing">
        <span class="dot" /><span class="dot" /><span class="dot" />
      </div>
    </main>

    <!-- Input bar -->
    <footer class="input-bar">
      <div class="input-bar__inner">
        <input
          ref="inputRef"
          v-model="userInput"
          class="input-bar__field"
          :placeholder="inputPlaceholder"
          :disabled="loading || (!profile && onboardStep !== 'name')"
          @keydown.enter.prevent="handleSend"
        />
        <button
          class="input-bar__send"
          :disabled="!canSend"
          @click="handleSend"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from "vue";
import ChatMessage from "./components/ChatMessage.vue";
import type { ChatMessage as ChatMessageType, ContentBlock, UserProfile } from "./types";
import * as api from "./api";

// ── State ───────────────────────────────────────────────────

const profile = ref<UserProfile | null>(null);
const messages = ref<ChatMessageType[]>([]);
const userInput = ref("");
const loading = ref(false);
const chatAreaRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

// Onboarding
const onboardStep = ref<"formality" | "name">("formality");
const chosenFormality = ref<"du" | "sie">("du");

// ── Computed ────────────────────────────────────────────────

const canSend = computed(() => {
  if (loading.value) return false;
  if (!profile.value && onboardStep.value === "name") return userInput.value.trim().length > 0;
  if (profile.value) return userInput.value.trim().length > 0;
  return false;
});

const inputPlaceholder = computed(() => {
  if (!profile.value && onboardStep.value === "name") return "Dein Name…";
  return "Nachricht schreiben…";
});

// ── Onboarding blocks ───────────────────────────────────────

const onboardFormalityBlocks: ContentBlock[] = [
  { type: "text", text: "Hallo! Ich bin dein **Sparbot** — dein persönlicher KI-Finanzberater. 🤖\n\nWie soll ich dich ansprechen?" },
  { type: "actions", buttons: [
    { label: "Du", value: "du" },
    { label: "Sie", value: "sie" },
  ]},
];

const onboardNameBlocks = computed<ContentBlock[]>(() => {
  const verb = chosenFormality.value === "du" ? "heißt du" : "heißen Sie";
  return [
    { type: "text", text: `Sehr gut! Und wie ${verb}?` },
  ];
});

// ── Lifecycle ───────────────────────────────────────────────

onMounted(async () => {
  await api.ensureSession();
  const p = await api.loadProfile();
  if (p) {
    profile.value = p;
    const msgs = await api.loadMessages();
    messages.value = msgs;

    // Check for new imports
    if (msgs.length > 0) {
      const { hasNew, count } = await api.checkNewImports();
      if (hasNew) {
        addLocalAssistant([
          { type: "text", text: `Ich sehe, dass seit unserem letzten Gespräch **${count} neue Imports** hinzugekommen sind. Soll ich meine Analyse aktualisieren?` },
          { type: "actions", buttons: [
            { label: "🔄 Analyse aktualisieren", value: "Aktualisiere die Analyse mit den neuen Daten" },
            { label: "💬 Ohne Update weiterchatten", value: "Lass uns einfach weiterchatten" },
          ]},
        ]);
      }
    }

    // Welcome back if no new imports notification was shown
    if (msgs.length === 0) {
      addWelcomeMessage();
    }

    scrollToBottom();
  }
  nextTick(() => inputRef.value?.focus());
});

// ── Handlers ────────────────────────────────────────────────

function handleFormalityChoice(value: string) {
  chosenFormality.value = value as "du" | "sie";
  onboardStep.value = "name";
  nextTick(() => inputRef.value?.focus());
}

async function handleSend() {
  const text = userInput.value.trim();
  if (!text) return;
  userInput.value = "";

  // Onboarding: name step
  if (!profile.value && onboardStep.value === "name") {
    await completeOnboarding(text);
    return;
  }

  // Normal chat
  await sendChatMessage(text);
}

async function handleAction(value: string) {
  await sendChatMessage(value);
}

// ── Chat logic ──────────────────────────────────────────────

async function completeOnboarding(name: string) {
  loading.value = true;
  try {
    await api.saveProfile(name, chosenFormality.value);
    profile.value = { display_name: name, formality: chosenFormality.value, created_on: new Date().toISOString() };
    addWelcomeMessage();
    scrollToBottom();
  } catch (err) {
    console.error("Onboarding failed:", err);
  } finally {
    loading.value = false;
    nextTick(() => inputRef.value?.focus());
  }
}

async function sendChatMessage(text: string) {
  // Add user message locally
  messages.value.push({
    id: Date.now(),
    role: "user",
    content: [{ type: "text", text }],
    created_on: new Date().toISOString(),
  });
  scrollToBottom();

  loading.value = true;
  try {
    const response = await api.sendMessage(text);
    messages.value.push(response);
    scrollToBottom();
  } catch (err) {
    console.error("Chat failed:", err);
    addLocalAssistant([
      { type: "text", text: "Entschuldigung, da ist etwas schiefgelaufen. Bitte versuche es erneut." },
    ]);
  } finally {
    loading.value = false;
    nextTick(() => inputRef.value?.focus());
  }
}

// ── Helpers ──────────────────────────────────────────────────

function addWelcomeMessage() {
  const name = profile.value?.display_name || "User";
  const formal = profile.value?.formality === "sie";
  const greeting = formal
    ? `Hallo ${name}, schön Sie wieder zu sehen! Was wollen Sie heute besprechen?`
    : `Hallo ${name}! Was willst du heute besprechen?`;

  addLocalAssistant([
    { type: "text", text: greeting },
    { type: "actions", buttons: [
      { label: "📊 Ausgaben analysieren", value: "Analysiere meine Ausgaben" },
      { label: "💡 Spartipps erhalten", value: "Gib mir Spartipps basierend auf meinen Ausgaben" },
      { label: "📋 Kategorien anzeigen", value: "Zeig mir meine Ausgaben nach Kategorien" },
    ]},
  ]);
}

function addLocalAssistant(content: ContentBlock[]) {
  messages.value.push({
    id: Date.now(),
    role: "assistant",
    content,
    created_on: new Date().toISOString(),
  });
}

function scrollToBottom() {
  nextTick(() => {
    if (chatAreaRef.value) {
      chatAreaRef.value.scrollTop = chatAreaRef.value.scrollHeight;
    }
  });
}
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-width: 720px;
  margin: 0 auto;
}

/* ── Header ────────────────────────────────────────────────── */

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-lg) var(--space-xl);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-surface);
  flex-shrink: 0;
}

.app-header__brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.app-header__icon {
  font-size: 1.4rem;
}

.app-header__title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  background: linear-gradient(135deg, var(--color-accent), #a78bfa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.app-header__user {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

/* ── Chat area ─────────────────────────────────────────────── */

.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-lg) var(--space-xl);
}

/* ── Typing indicator ──────────────────────────────────────── */

.chat-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-lg) 0;
  padding-left: 48px; /* align with message body */
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-dim);
  animation: bounce 1.4s infinite ease-in-out both;
}

.dot:nth-child(1) { animation-delay: 0s; }
.dot:nth-child(2) { animation-delay: 0.16s; }
.dot:nth-child(3) { animation-delay: 0.32s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40%           { transform: scale(1);   opacity: 1; }
}

/* ── Input bar ─────────────────────────────────────────────── */

.input-bar {
  flex-shrink: 0;
  padding: var(--space-lg) var(--space-xl);
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-surface);
}

.input-bar__inner {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-xs) var(--space-xs) var(--space-xs) var(--space-lg);
  transition: border-color var(--transition-fast);
}

.input-bar__inner:focus-within {
  border-color: var(--color-accent);
}

.input-bar__field {
  flex: 1;
  border: none;
  background: transparent;
  padding: var(--space-sm) 0;
  font-size: var(--font-size-md);
  color: var(--color-text);
  outline: none;
}

.input-bar__field::placeholder {
  color: var(--color-text-dim);
}

.input-bar__send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: white;
  transition:
    background var(--transition-fast),
    transform var(--transition-fast);
}

.input-bar__send:hover:not(:disabled) {
  background: var(--color-accent-hover);
  transform: scale(1.05);
}

.input-bar__send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
