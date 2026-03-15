/**
 * API Client for Sparbot
 *
 * All fetch calls go through this module for consistent
 * error handling and token management.
 */

import type { ChatMessage, UserProfile, UsageInfo } from "./types";

const BASE = import.meta.env.VITE_API_BASE || "";

/**
 * Token resolution order:
 * 1. URL query param ?token=xxx  (link from anonymizer)
 * 2. localStorage sparbot_token  (returning user)
 * 3. Create new session          (first visit without link)
 */
function resolveToken(): string | null {
    // Check URL param first
    const url = new URL(window.location.href);
    const urlToken = url.searchParams.get("token");
    if (urlToken) {
        localStorage.setItem("sparbot_token", urlToken);
        // Clean URL without reload
        url.searchParams.delete("token");
        window.history.replaceState({}, "", url.toString());
        return urlToken;
    }
    return localStorage.getItem("sparbot_token");
}

let _token: string | null = resolveToken();

function headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (_token) h["x-token"] = _token;
    return h;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: headers(),
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

// ── Session ─────────────────────────────────────────────────

export async function createSession(): Promise<string> {
    const res = await request<{ token: string }>("POST", "/api/session");
    _token = res.token;
    localStorage.setItem("sparbot_token", _token);
    return _token;
}

export async function ensureSession(): Promise<string> {
    if (_token) return _token;
    return createSession();
}

// ── Profile ─────────────────────────────────────────────────

export async function loadProfile(): Promise<UserProfile | null> {
    try {
        const res = await request<{ data: UserProfile }>("GET", "/api/profile");
        return res.data;
    } catch {
        return null;
    }
}

export async function saveProfile(displayName: string, formality: "du" | "sie"): Promise<void> {
    await request("POST", "/api/profile", { display_name: displayName, formality });
}

// ── Messages ────────────────────────────────────────────────

export async function loadMessages(): Promise<ChatMessage[]> {
    const res = await request<{ data: ChatMessage[] }>("GET", "/api/messages");
    return res.data;
}

// ── Chat ────────────────────────────────────────────────────

export async function sendMessage(message: string): Promise<ChatMessage> {
    const res = await request<{ data: ChatMessage }>("POST", "/api/chat", { message });
    return res.data;
}

// ── Usage ───────────────────────────────────────────────────

export async function loadUsage(): Promise<UsageInfo> {
    const res = await request<{ data: UsageInfo }>("GET", "/api/usage");
    return res.data;
}

// ── New Imports ─────────────────────────────────────────────

export async function checkNewImports(): Promise<{ hasNew: boolean; count: number }> {
    const res = await request<{ data: { hasNew: boolean; count: number } }>("GET", "/api/new-imports");
    return res.data;
}
