import { parseCsv } from "./csv";
import { detectHeader } from "./headerDetect";
import { applyMapping } from "./transform";
import { applyAnonymization } from "./anonymize";
import { defaultDisplaySettings, parseAmountToNumber } from "./displaySettings";
import type { BankMapping, UnifiedTx, AnonRule } from "./types";

export type Detection =
  | { kind: "matched"; mapping: BankMapping; header: string[]; dataRows: string[][] }
  | { kind: "unknown"; header: string[]; candidates: any[] };

const DEFAULT_RULES: AnonRule[] = [
  {
    id: "iban_mask",
    fields: ["booking_text"],
    type: "regex",
    pattern: "(DE\\d{2})[\\s-]?((?:\\d[\\s-]?){18})",
    flags: "gi",
    replacement: "$1 XXXX XXXX XXXX XXXX XX",
    enabled: true,
  },
  {
    id: "refnum_mask",
    fields: ["booking_text"],
    type: "regex",
    pattern: "(?:KUNDEN|VERTRAG|VORGANG|REFERENZ|MANDAT|AUSZUG)\\s*[-#: ]?\\s*\\d{3,}",
    flags: "gi",
    replacement: "[REF XXX]",
    enabled: true,
  },
  {
    id: "email_mask",
    fields: ["booking_text"],
    type: "regex",
    pattern: "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}",
    flags: "gi",
    replacement: "[EMAIL]",
    enabled: true,
  },
  {
    id: "digits_mask",
    fields: ["booking_text"],
    type: "regex",
    pattern: "\\d{3,}",
    flags: "g",
    replacement: "XXX",
    enabled: true,
  },
];

export async function detectBankAndPrepare(file: File, mappings: BankMapping[]): Promise<Detection> {
  const rows = await parseCsv(file);
  const result = detectHeader(rows, mappings);
  const best = result.candidates.find((c) => c.passed) ?? null;
  if (!best) {
    return { kind: "unknown", header: result.header, candidates: result.candidates };
  }
  return {
    kind: "matched",
    mapping: best.mapping,
    header: result.header,
    dataRows: result.dataRows,
  };
}

export async function buildMaskedTransactions(params: {
  mapping: BankMapping;
  header: string[];
  dataRows: string[][];
  accountAlias: string;
}): Promise<{ masked: UnifiedTx[]; upload: any[]; warnings: string[] }> {
  const display = defaultDisplaySettings();
  const tx = applyMapping(
    params.dataRows,
    params.header,
    {
      booking_date: params.mapping.booking_date,
      booking_text: params.mapping.booking_text,
      booking_type: params.mapping.booking_type,
      booking_amount: params.mapping.booking_amount,
      booking_date_parse_format: params.mapping.booking_date_parse_format,
      without_header: params.mapping.without_header,
    },
    params.mapping.bank_name,
    params.accountAlias,
    display
  );

  const anonym = await applyAnonymization(tx, DEFAULT_RULES);

  const upload = anonym.data.map((t) => ({
    bank_name: t.bank_name,
    booking_date: t.booking_date,
    booking_date_raw: t.booking_date_raw,
    booking_date_iso: t.booking_date_iso,
    booking_text: t.booking_text,
    booking_type: t.booking_type,
    booking_amount: t.booking_amount,
    booking_amount_value: parseAmountToNumber(t.booking_amount),
    booking_hash: t.booking_hash,
  }));

  return { masked: anonym.data, upload, warnings: anonym.warnings };
}

export function buildOriginalTransactions(params: {
  mapping: BankMapping;
  header: string[];
  dataRows: string[][];
  accountAlias: string;
}): UnifiedTx[] {
  const display = defaultDisplaySettings();
  return applyMapping(
    params.dataRows,
    params.header,
    {
      booking_date: params.mapping.booking_date,
      booking_text: params.mapping.booking_text,
      booking_type: params.mapping.booking_type,
      booking_amount: params.mapping.booking_amount,
      booking_date_parse_format: params.mapping.booking_date_parse_format,
      without_header: params.mapping.without_header,
    },
    params.mapping.bank_name,
    params.accountAlias,
    display
  );
}
