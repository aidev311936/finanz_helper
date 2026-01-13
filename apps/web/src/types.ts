export type Action =
  | { type: "button"; label: string; value: string }
  | { type: "text"; label: string; placeholder?: string; submitLabel?: string }
  | { type: "date"; label: string }
  | { type: "file"; label: string; accept: string };

export type ChatResponse = {
  message: string;
  actions?: Action[];
  ui_hint?: "info" | "warning" | "success";
};

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  actions?: Action[];
};
