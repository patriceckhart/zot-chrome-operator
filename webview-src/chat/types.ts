export type ChatRole = "user" | "assistant" | "tool" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** Tool name when role === "tool". */
  tool?: string;
  /** Pending = still streaming or running. */
  pending?: boolean;
  isError?: boolean;
}

export interface UsageSnapshot {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
  cost_usd?: number;
}

export interface AgentState {
  provider?: string;
  model?: string;
  cwd?: string;
  busy?: boolean;
  usage?: UsageSnapshot;
}

/** One file or image attached to a prompt. */
export type PromptAttachment =
  | {
      kind: "image";
      name: string;
      mimeType: string;
      /** Base64-encoded bytes, no data: prefix. */
      base64: string;
      /** Size in bytes, used for display only. */
      bytes: number;
    }
  | {
      kind: "text";
      name: string;
      /** Decoded UTF-8 text. */
      text: string;
      bytes: number;
    };

/** Mirrors `CatalogModel` in the extension host (zotHome.ts). */
export interface CatalogModel {
  Provider: string;
  ID: string;
  DisplayName?: string;
  ContextWindow?: number;
  MaxOutput?: number;
  Reasoning?: boolean;
  /** Future/unreleased model. We show a "speculative" badge. */
  Speculative?: boolean;
  PriceInput?: number;
  PriceOutput?: number;
  Source?: string;
}

export interface ModelsSnapshot {
  authedProviders: string[];
  models: CatalogModel[];
  sources: { auth?: string; cache?: string; custom?: string };
}

/** One row in the session switcher. Mirrors SessionSummary in zotHome.ts. */
export interface SessionSummary {
  path: string;
  firstUserText?: string;
  title?: string;
  started?: string;
  model?: string;
  provider?: string;
  messageCount: number;
  mtime: number;
}

export interface SessionTranscriptMessage {
  role: string;
  content: any[];
  time?: string;
}

export interface SessionTranscript {
  meta?: {
    id?: string;
    cwd?: string;
    model?: string;
    provider?: string;
    started?: string;
    title?: string;
  };
  messages: SessionTranscriptMessage[];
}
