// ── Content Block Types ─────────────────────────────────────

export interface TextBlock {
    type: "text";
    text: string;
}

export interface TableBlock {
    type: "table";
    caption?: string;
    columns: string[];
    rows: string[][];
}

export interface ActionButton {
    label: string;
    value: string;
}

export interface ActionsBlock {
    type: "actions";
    buttons: ActionButton[];
}

export type ContentBlock = TextBlock | TableBlock | ActionsBlock;

// ── Message ─────────────────────────────────────────────────

export interface ChatMessage {
    id: number;
    role: "user" | "assistant";
    content: ContentBlock[];
    selected_action?: string | null;
    created_on: string;
}

// ── Profile ─────────────────────────────────────────────────

export interface UserProfile {
    display_name: string;
    formality: "du" | "sie";
    created_on: string;
}

// ── Usage ───────────────────────────────────────────────────

export interface UsageInfo {
    input_tokens: number;
    output_tokens: number;
    request_count: number;
    limits: {
        daily_requests: number;
        daily_tokens: number;
    };
}
