const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

export async function ensureSession(): Promise<void> {
  await fetch(`${API_BASE}/api/session`, {
    method: "POST",
    credentials: "include",
  });
}

export async function fetchBankMappings(): Promise<any[]> {
  const r = await fetch(`${API_BASE}/api/bank-mapping`, {
    credentials: "include",
  });
  if (!r.ok) throw new Error(`bank_mappings_failed_${r.status}`);
  const json = await r.json();
  return Array.isArray(json.mappings) ? json.mappings : [];
}

export async function requestBankSupport(bank_name: string): Promise<void> {
  const r = await fetch(`${API_BASE}/api/bank-format-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ bank_name }),
  });
  if (!r.ok) throw new Error(`bank_request_failed_${r.status}`);
}

export async function createAccount(bank_name: string, alias: string): Promise<{ id: number; bank_name: string; alias: string }>
{
  const r = await fetch(`${API_BASE}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ bank_name, alias }),
  });
  if (!r.ok) throw new Error(`create_account_failed_${r.status}`);
  const json = await r.json();
  return json.data;
}

export async function createImport(account_id: number): Promise<{ import_id: number }> {
  const r = await fetch(`${API_BASE}/api/imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
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
  const r = await fetch(`${API_BASE}/api/transactions/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`upload_failed_${r.status}`);
  const json = await r.json();
  return json.data;
}

export async function runCategorization(import_id: number): Promise<{ job_id: number }> {
  const r = await fetch(`${API_BASE}/api/categorization/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ import_id }),
  });
  if (!r.ok) throw new Error(`categorize_failed_${r.status}`);
  const json = await r.json();
  return json.data;
}
