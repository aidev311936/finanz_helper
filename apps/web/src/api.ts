import type { ChatResponse } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

export async function ensureSession(): Promise<void> {
  // create session cookie
  await fetch(`${API_BASE}/api/session`, {
    method: "POST",
    credentials: "include"
  });
}

export async function sendChat(content: string): Promise<ChatResponse> {
  const r = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ content })
  });
  if (!r.ok) throw new Error(`chat_failed_${r.status}`);
  return await r.json();
}
