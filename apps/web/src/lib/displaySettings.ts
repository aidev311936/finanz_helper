import { DisplaySettings } from "./types";

export const DEFAULT_DATE_DISPLAY_FORMAT = "dd.MM.yyyy";
export const DEFAULT_AMOUNT_DISPLAY_FORMAT = "#.##0,00";

export function defaultDisplaySettings(): DisplaySettings {
  return {
    booking_date_display_format: DEFAULT_DATE_DISPLAY_FORMAT,
    booking_amount_display_format: DEFAULT_AMOUNT_DISPLAY_FORMAT,
  };
}

export function parseAmountToNumber(value: string): number | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;

  let sanitized = trimmed.replace(/[\s'\u00A0]/g, "");
  const lastComma = sanitized.lastIndexOf(",");
  const lastDot = sanitized.lastIndexOf(".");
  let decimalSeparator = "";
  if (lastComma > lastDot) decimalSeparator = ",";
  else if (lastDot > lastComma) decimalSeparator = ".";

  let result = "";
  const decimalIndex =
    decimalSeparator === "," ? lastComma : decimalSeparator === "." ? lastDot : -1;

  for (let i = 0; i < sanitized.length; i += 1) {
    const ch = sanitized[i];
    if (i === 0 && (ch === "-" || ch === "+")) {
      if (ch === "-") result += "-";
      continue;
    }
    if (ch === decimalSeparator) {
      if (i === decimalIndex) result += ".";
      continue;
    }
    if (ch === "," || ch === ".") continue;
    if (/\d/.test(ch)) result += ch;
  }

  if (result === "" || result === "-") return null;
  const parsed = Number.parseFloat(result);
  return Number.isFinite(parsed) ? parsed : null;
}
