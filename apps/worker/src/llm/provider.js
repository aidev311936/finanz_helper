import { extractJson } from "./json.js";

function pickEnv(name, fallback = "") {
  return process.env[name] ?? fallback;
}

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`llm_http_${r.status}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

export class LLM {
  constructor() {
    this.provider = (pickEnv("LLM_PROVIDER", "openai")).toLowerCase();
    this.model = pickEnv("LLM_MODEL", this.provider === "gemini" ? "gemini-1.5-flash" : "gpt-4o-mini");
    this.openaiKey = pickEnv("OPENAI_API_KEY");
    this.openaiBaseUrl = pickEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
    this.geminiKey = pickEnv("GEMINI_API_KEY");
    this.geminiBaseUrl = pickEnv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta");
    this.localBaseUrl = pickEnv("LOCAL_LLM_BASE_URL", "http://local-llm:8000/v1");
    this.localKey = pickEnv("LOCAL_LLM_API_KEY", "");
  }

  async generateText(messages, { temperature = 0.2 } = {}) {
    if (this.provider === "gemini") return await this.#geminiText(messages, temperature);
    if (this.provider === "local") return await this.#openaiCompatibleText(messages, temperature);
    return await this.#openaiText(messages, temperature);
  }

  async generateJson(messages, { temperature = 0.1 } = {}) {
    const text = await this.generateText(
      [...messages, { role: "system", content: "Output ONLY valid JSON. No markdown, no comments." }],
      { temperature }
    );
    return extractJson(text);
  }

  async #openaiText(messages, temperature) {
    if (!this.openaiKey) throw new Error("missing_OPENAI_API_KEY");
    const url = `${this.openaiBaseUrl.replace(/\/$/, "")}/responses`;
    const payload = {
      model: this.model,
      input: messages.map((m) => ({ role: m.role, content: [{ type: "input_text", text: m.content }] })),
      temperature
    };
    const data = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.openaiKey}` },
      body: JSON.stringify(payload)
    });
    const out = data?.output?.[0]?.content;
    if (Array.isArray(out)) {
      const text = out.filter((c) => c.type === "output_text").map((c) => c.text).join("\n");
      if (text) return text;
    }
    return data?._raw || JSON.stringify(data);
  }

  async #openaiCompatibleText(messages, temperature) {
    const base = this.localBaseUrl.replace(/\/$/, "");
    const url = `${base}/chat/completions`;
    const payload = { model: this.model, messages, temperature };
    const headers = { "Content-Type": "application/json" };
    if (this.localKey) headers.Authorization = `Bearer ${this.localKey}`;
    const data = await fetchJson(url, { method: "POST", headers, body: JSON.stringify(payload) });
    return data?.choices?.[0]?.message?.content || data?._raw || JSON.stringify(data);
  }

  async #geminiText(messages, temperature) {
    if (!this.geminiKey) throw new Error("missing_GEMINI_API_KEY");
    const base = this.geminiBaseUrl.replace(/\/$/, "");
    const url = `${base}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.geminiKey)}`;
    const system = messages.find((m) => m.role === "system")?.content || "";
    const nonSystem = messages.filter((m) => m.role !== "system");
    const payload = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: nonSystem.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { temperature }
    };
    const data = await fetchJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n");
    return text || data?._raw || JSON.stringify(data);
  }
}
