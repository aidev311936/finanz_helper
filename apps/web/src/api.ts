const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

// Option A: Use a per-user token header instead of cookies.
// This avoids SameSite/CORS cookie issues on Render (and with custom domains).
const TOKEN_KEY = "hm_token";

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore (private mode, blocked storage, ...)
  }
}

async function ensureToken(): Promise<string> {
  const existing = getToken();
  if (existing) return existing;

  const r = await fetch(`${API_BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`session_failed_${r.status}`);
  const json = await r.json();
  const token = String(json?.token || "");
  if (!token) throw new Error("session_failed_missing_token");
  setToken(token);
  return token;
}

async function authFetch(path: string, init: RequestInit = {}) {
  const token = await ensureToken();

  const headers = new Headers(init.headers || {});
  headers.set("x-token", token);

  // Ensure JSON content-type for requests with a body unless caller sets otherwise.
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
}

export async function ensureSession(): Promise<void> {
  await ensureToken();
}

export async function fetchBankMappings(): Promise<any[]> {
  const r = await authFetch(`/api/bank-mapping`);
  if (!r.ok) throw new Error(`bank_mappings_failed_${r.status}`);
  const json = await r.json();
  return Array.isArray(json.mappings) ? json.mappings : [];
}

export async function requestBankSupport(bank_name: string): Promise<void> {
  const r = await authFetch(`/api/bank-format-requests`, {
    method: "POST",
    body: JSON.stringify({ bank_name }),
  });
  if (!r.ok) throw new Error(`bank_request_failed_${r.status}`);
}

export async function createAccount(
  bank_name: string,
  alias: string
): Promise<{ id: number; bank_name: string; alias: string }> {
  const r = await authFetch(`/api/accounts`, {
    method: "POST",
    body: JSON.stringify({ bank_name, alias }),
  });
  if (!r.ok) throw new Error(`create_account_failed_${r.status}`);
  const json = await r.json();
  return json.data;
}

export async function createImport(account_id: number): Promise<{ import_id: number }> {
  const r = await authFetch(`/api/imports`, {
    method: "POST",
    body: JSON.stringify({ account_id }),
  });
  if (!r.ok) throw new Error(`create_import_failed_${r.status}`);
  const json = await r.json();
  return json.data;
}

export async function uploadMaskedTransactions(payload: {
  import_id: number;
  account_id: number;
  transactions: any[];
}): Promise<{ inserted: number; skipped_duplicates: number }> {
  const r = await authFetch(`/api/transactions/bulk`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`upload_failed_${r.status}`);
  const json = await r.json();
  return json.data;
}


export async function sendChat(content: string): Promise<{ message: string; actions?: any[] }> {
  const r = await authFetch(`/api/chat`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  if (!r.ok) throw new Error(`chat_failed_${r.status}`);
  return await r.json();
}

// Transform API response to AnonRule format
function transformRule(apiRule: any): any {
  return {
    id: apiRule.id,
    name: apiRule.name,
    type: apiRule.rule_type,  // rule_type -> type
    fields: ['booking_text'],  // Default to booking_text
    pattern: apiRule.pattern,
    flags: apiRule.flags,
    replacement: apiRule.replacement,
    description: apiRule.description,
    enabled: apiRule.enabled ?? true,
  };
}

export async function fetchAnonRules(): Promise<any[]> {
  const r = await authFetch(`/api/anon-rules`);
  if (!r.ok) throw new Error(`fetch_rules_failed_${r.status}`);
  const json = await r.json();
  return (json.rules || []).map(transformRule);
}

export async function createAnonRule(rule: {
  name: string;
  pattern: string;
  flags?: string;
  replacement: string;
  description?: string;
}): Promise<any> {
  const r = await authFetch(`/api/anon-rules`, {
    method: "POST",
    body: JSON.stringify(rule),
  });
  if (!r.ok) throw new Error(`create_rule_failed_${r.status}`);
  const json = await r.json();
  return transformRule(json.rule);
}

export async function updateAnonRule(id: number, updates: {
  name?: string;
  pattern?: string;
  flags?: string;
  replacement?: string;
  description?: string;
  enabled?: boolean;
}): Promise<any> {
  const r = await authFetch(`/api/anon-rules/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  if (!r.ok) throw new Error(`update_rule_failed_${r.status}`);
  const json = await r.json();
  return transformRule(json.rule);
}

export async function deleteAnonRule(id: number): Promise<void> {
  const r = await authFetch(`/api/anon-rules/${id}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(`delete_rule_failed_${r.status}`);
}
