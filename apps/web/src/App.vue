<template>
  <div class="app">
    <header class="topbar">
      <div class="title">Haushaltmanager</div>
      <div class="subtitle">Ausgaben verstehen. Ausgaben senken.</div>
    </header>

    <main class="chat">
      <div class="messages">
        <div
          v-for="(m, idx) in messages"
          :key="idx"
          class="msg"
          :class="m.role"
        >
          <div class="bubble">
            <div class="text">{{ m.text }}</div>
            <div v-if="m.actions?.length" class="actions">
              <ActionRenderer
                :actions="m.actions"
                @action="handleAction"
              />
            </div>
          </div>
        </div>
      </div>

      <form class="composer" @submit.prevent="onSend">
        <input
          v-model="draft"
          class="input"
          placeholder="Schreib mir eine Frage…"
          autocomplete="off"
        />
        <button class="send" :disabled="busy || !draft.trim()">
          Senden
        </button>
      </form>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import ActionRenderer from "./components/ActionRenderer.vue";
import { ensureSession, sendChat } from "./api";
import type { ChatMessage } from "./types";

const messages = ref<ChatMessage[]>([
  { role: "assistant", text: "Hi! Lade zuerst deinen Kontoauszug hoch. (Upload-Flow kommt als nächstes)" }
]);

const draft = ref("");
const busy = ref(false);

onMounted(async () => {
  await ensureSession();
});

async function onSend() {
  const text = draft.value.trim();
  if (!text) return;

  messages.value.push({ role: "user", text });
  draft.value = "";
  busy.value = true;

  try {
    const res = await sendChat(text);
    messages.value.push({
      role: "assistant",
      text: res.message,
      actions: res.actions
    });
  } finally {
    busy.value = false;
  }
}

function handleAction(value: string) {
  // Actions werden wie eine User Message behandelt
  draft.value = value;
  onSend();
}
</script>

<style scoped>
.app { height: 100vh; display: flex; flex-direction: column; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }
.topbar { padding: 14px 14px 10px; border-bottom: 1px solid #eee; }
.title { font-weight: 700; font-size: 18px; }
.subtitle { font-size: 12px; opacity: 0.7; margin-top: 4px; }
.chat { flex: 1; display: flex; flex-direction: column; }
.messages { flex: 1; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.msg.assistant { justify-content: flex-start; }
.bubble { max-width: 82%; border: 1px solid #eee; border-radius: 14px; padding: 10px 12px; }
.msg.user .bubble { border-color: #ddd; }
.text { white-space: pre-wrap; line-height: 1.35; }
.actions { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; }
.composer { padding: 12px; border-top: 1px solid #eee; display: flex; gap: 10px; }
.input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 12px; font-size: 14px; }
.send { padding: 12px 14px; border-radius: 12px; border: 1px solid #ddd; background: #fff; }
.send:disabled { opacity: 0.5; }
</style>
