// Tiny helpers to deal with "model returns JSON-ish" across providers.

/**
 * Extract the first JSON object/array from a text.
 * Works with common patterns like ```json ... ``` or leading prose.
 */
export function extractJson(text) {
  if (!text) throw new Error("empty_llm_output");

  const s = String(text)
    .replace(/```json\s*/gi, "```")
    .replace(/```\s*/g, "")
    .trim();

  // Fast path: direct JSON
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    return JSON.parse(s);
  }

  // Try to locate the first JSON object/array.
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  let start = -1;
  let open = "";
  let close = "";
  if (firstObj === -1 && firstArr === -1) throw new Error("no_json_found");
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr;
    open = "[";
    close = "]";
  } else {
    start = firstObj;
    open = "{";
    close = "}";
  }

  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === open) depth++;
    if (ch === close) depth--;
    if (depth === 0) {
      const candidate = s.slice(start, i + 1);
      return JSON.parse(candidate);
    }
  }
  throw new Error("unterminated_json");
}

export function stringifyCompact(obj) {
  return JSON.stringify(obj, null, 0);
}
