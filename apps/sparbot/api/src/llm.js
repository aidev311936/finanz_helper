/**
 * Multi-LLM Adapter
 *
 * Supports OpenAI, Gemini, and Anthropic via ENV:
 *   LLM_PROVIDER = "openai" | "gemini" | "anthropic"
 *
 * Each provider returns { content, inputTokens, outputTokens }.
 */

import OpenAI from "openai";

// ── Provider implementations ────────────────────────────────

async function openaiChat({ systemPrompt, messages, maxTokens }) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
        model: process.env.LLM_MODEL || "gpt-4o-mini",
        max_tokens: maxTokens,
        messages: [
            { role: "system", content: systemPrompt },
            ...messages,
        ],
    });
    return {
        content: res.choices[0].message.content,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
    };
}

async function geminiChat({ systemPrompt, messages, maxTokens }) {
    // Gemini uses the OpenAI-compatible endpoint
    const client = new OpenAI({
        apiKey: process.env.GEMINI_API_KEY,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
    const res = await client.chat.completions.create({
        model: process.env.LLM_MODEL || "gemini-2.5-flash",
        max_tokens: maxTokens,
        messages: [
            { role: "system", content: systemPrompt },
            ...messages,
        ],
    });
    return {
        content: res.choices[0].message.content,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
    };
}

async function anthropicChat({ systemPrompt, messages, maxTokens }) {
    // Anthropic also has an OpenAI-compatible proxy via openai SDK
    const client = new OpenAI({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: "https://api.anthropic.com/v1/",
    });
    const res = await client.chat.completions.create({
        model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        messages: [
            { role: "system", content: systemPrompt },
            ...messages,
        ],
    });
    return {
        content: res.choices[0].message.content,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
    };
}

// ── Public API ──────────────────────────────────────────────

const providers = { openai: openaiChat, gemini: geminiChat, anthropic: anthropicChat };

/**
 * Send a chat completion request to the configured LLM provider.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt  - System-level instructions
 * @param {Array}  opts.messages      - Array of { role, content }
 * @param {number} [opts.maxTokens]   - Max response tokens (default 1024)
 * @returns {Promise<{ content: string, inputTokens: number, outputTokens: number }>}
 */
export async function chatCompletion({ systemPrompt, messages, maxTokens = 1024 }) {
    const provider = process.env.LLM_PROVIDER || "openai";
    const handler = providers[provider];
    if (!handler) {
        throw new Error(
            `Unknown LLM_PROVIDER "${provider}". Supported: ${Object.keys(providers).join(", ")}`
        );
    }
    return handler({ systemPrompt, messages, maxTokens });
}

/**
 * Check which provider is currently configured and whether its API key is set.
 */
export function llmStatus() {
    const provider = process.env.LLM_PROVIDER || "openai";
    const keyMap = { openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
    const keyName = keyMap[provider] || "UNKNOWN";
    return {
        provider,
        model: process.env.LLM_MODEL || "(default)",
        hasKey: !!process.env[keyName],
    };
}
