import type { CatalogModel } from "./zotHome";

/**
 * Curated snapshot of zot's hardcoded `var Catalog` in
 * `packages/provider/models.go`. We need this because zot's RPC
 * `get_models` strips two fields we want to surface in the picker:
 *
 *   - DisplayName  (e.g. "Claude Opus 4.5" vs raw id `claude-opus-4-5`)
 *   - Speculative  (the "future / unreleased" flag — we show a badge)
 *
 * The probe still drives which models exist (so it stays in sync with
 * whatever zot the user has installed); this table only fills in
 * cosmetic metadata by `(provider, id)` lookup. Unknown ids fall back
 * to the raw id with no speculative badge.
 *
 * Keep this in dependency order: stable models first, speculative last,
 * matching the Go source. Refresh whenever zot ships a model list bump.
 */
export interface CatalogEntry {
  provider: string;
  id: string;
  displayName: string;
  contextWindow?: number;
  maxOutput?: number;
  reasoning?: boolean;
  speculative?: boolean;
}

export const STATIC_CATALOG: CatalogEntry[] = [
  // ---- Anthropic / Claude 4.x ----
  { provider: "anthropic", id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5", contextWindow: 200000, maxOutput: 64000, reasoning: true },
  { provider: "anthropic", id: "claude-opus-4-1", displayName: "Claude Opus 4.1", contextWindow: 200000, maxOutput: 32000, reasoning: true },
  { provider: "anthropic", id: "claude-opus-4-0", displayName: "Claude Opus 4", contextWindow: 200000, maxOutput: 32000, reasoning: true },
  { provider: "anthropic", id: "claude-sonnet-4-0", displayName: "Claude Sonnet 4", contextWindow: 200000, maxOutput: 64000, reasoning: true },
  { provider: "anthropic", id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", contextWindow: 200000, maxOutput: 64000, reasoning: true },
  { provider: "anthropic", id: "claude-3-7-sonnet-20250219", displayName: "Claude Sonnet 3.7", contextWindow: 200000, maxOutput: 64000, reasoning: true },
  { provider: "anthropic", id: "claude-3-5-sonnet-20241022", displayName: "Claude Sonnet 3.5 v2", contextWindow: 200000, maxOutput: 8192, reasoning: false },
  { provider: "anthropic", id: "claude-3-5-haiku-latest", displayName: "Claude Haiku 3.5", contextWindow: 200000, maxOutput: 8192, reasoning: false },
  { provider: "anthropic", id: "claude-3-opus-20240229", displayName: "Claude Opus 3", contextWindow: 200000, maxOutput: 4096, reasoning: false },

  // ---- DeepSeek ----
  { provider: "deepseek", id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", contextWindow: 128000, maxOutput: 8192, reasoning: true },
  { provider: "deepseek", id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash", contextWindow: 128000, maxOutput: 8192, reasoning: false },

  // ---- Kimi (Moonshot) ----
  { provider: "kimi", id: "kimi-for-coding", displayName: "Kimi-k2.6", contextWindow: 262144, maxOutput: 32000, reasoning: true },

  // ---- OpenAI ----
  { provider: "openai", id: "gpt-5", displayName: "GPT-5", contextWindow: 400000, maxOutput: 128000, reasoning: true },
  { provider: "openai", id: "gpt-5-mini", displayName: "GPT-5 mini", contextWindow: 400000, maxOutput: 128000, reasoning: true },
  { provider: "openai", id: "gpt-5-nano", displayName: "GPT-5 nano", contextWindow: 400000, maxOutput: 128000, reasoning: true },
  { provider: "openai", id: "gpt-4.1", displayName: "GPT-4.1", contextWindow: 1047576, maxOutput: 32768, reasoning: false },
  { provider: "openai", id: "gpt-4.1-mini", displayName: "GPT-4.1 mini", contextWindow: 1047576, maxOutput: 32768, reasoning: false },
  { provider: "openai", id: "gpt-4.1-nano", displayName: "GPT-4.1 nano", contextWindow: 1047576, maxOutput: 32768, reasoning: false },
  { provider: "openai", id: "gpt-4o", displayName: "GPT-4o", contextWindow: 128000, maxOutput: 16384, reasoning: false },
  { provider: "openai", id: "gpt-4o-mini", displayName: "GPT-4o mini", contextWindow: 128000, maxOutput: 16384, reasoning: false },
  { provider: "openai", id: "o4-mini", displayName: "o4-mini", contextWindow: 200000, maxOutput: 100000, reasoning: true },
  { provider: "openai", id: "o3", displayName: "o3", contextWindow: 200000, maxOutput: 100000, reasoning: true },
  { provider: "openai", id: "o3-mini", displayName: "o3-mini", contextWindow: 200000, maxOutput: 100000, reasoning: true },
  { provider: "openai", id: "o1", displayName: "o1", contextWindow: 200000, maxOutput: 100000, reasoning: true },

  // ---- Google / Gemini ----
  { provider: "google", id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", contextWindow: 1048576, maxOutput: 65536, reasoning: true },
  { provider: "google", id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", contextWindow: 1048576, maxOutput: 65536, reasoning: true },
  { provider: "google", id: "gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash-Lite", contextWindow: 1048576, maxOutput: 65536, reasoning: true },
  { provider: "google", id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", contextWindow: 1048576, maxOutput: 8192, reasoning: false },
  { provider: "google", id: "gemini-2.0-flash-lite", displayName: "Gemini 2.0 Flash-Lite", contextWindow: 1048576, maxOutput: 8192, reasoning: false },

  // ---- Speculative: Anthropic ----
  { provider: "anthropic", id: "claude-opus-4-5", displayName: "Claude Opus 4.5", contextWindow: 200000, maxOutput: 64000, reasoning: true, speculative: true },
  { provider: "anthropic", id: "claude-opus-4-6", displayName: "Claude Opus 4.6", contextWindow: 1000000, maxOutput: 128000, reasoning: true, speculative: true },
  { provider: "anthropic", id: "claude-opus-4-7", displayName: "Claude Opus 4.7", contextWindow: 1000000, maxOutput: 128000, reasoning: true, speculative: true },
  { provider: "anthropic", id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", contextWindow: 1000000, maxOutput: 64000, reasoning: true, speculative: true },

  // ---- Speculative: OpenAI ----
  { provider: "openai", id: "gpt-5.1", displayName: "GPT-5.1", contextWindow: 272000, maxOutput: 128000, reasoning: true, speculative: true },
  { provider: "openai", id: "gpt-5.2", displayName: "GPT-5.2", contextWindow: 272000, maxOutput: 128000, reasoning: true, speculative: true },
  { provider: "openai", id: "gpt-5.3", displayName: "GPT-5.3", contextWindow: 272000, maxOutput: 128000, reasoning: true, speculative: true },
  { provider: "openai", id: "gpt-5.4", displayName: "GPT-5.4", contextWindow: 272000, maxOutput: 128000, reasoning: true, speculative: true },
  { provider: "openai", id: "gpt-5.4-mini", displayName: "GPT-5.4 mini", contextWindow: 272000, maxOutput: 128000, reasoning: true, speculative: true },
  { provider: "openai", id: "gpt-5.5", displayName: "GPT-5.5", contextWindow: 400000, maxOutput: 128000, reasoning: true, speculative: true },
  { provider: "openai", id: "gpt-5.5-mini", displayName: "GPT-5.5 mini", contextWindow: 400000, maxOutput: 128000, reasoning: true, speculative: true },
];

const CATALOG_BY_KEY = new Map<string, CatalogEntry>();
for (const e of STATIC_CATALOG) {
  CATALOG_BY_KEY.set(`${e.provider}::${e.id}`, e);
}

/**
 * Enrich a probed/cached model with metadata from the static catalog.
 * Anything the probe already knows wins; we only fill in blanks. This way
 * a future zot release that adds new fields to `get_models` will dominate
 * over our snapshot.
 */
export function enrichModel(m: CatalogModel): CatalogModel {
  const hit = CATALOG_BY_KEY.get(`${m.Provider}::${m.ID}`);
  if (!hit) return m;
  return {
    ...m,
    DisplayName: m.DisplayName || hit.displayName,
    ContextWindow: m.ContextWindow ?? hit.contextWindow,
    MaxOutput: m.MaxOutput ?? hit.maxOutput,
    Reasoning: m.Reasoning ?? hit.reasoning ?? false,
    Speculative: m.Speculative ?? hit.speculative ?? false,
  };
}

/**
 * Build a complete CatalogModel list from the static catalog, filtered to a
 * set of authed providers. Used as a baseline before the probes come back.
 */
export function staticModelsFor(authedProviders: Iterable<string>): CatalogModel[] {
  const allow = new Set(authedProviders);
  return STATIC_CATALOG.filter((e) => allow.has(e.provider)).map((e) => ({
    Provider: e.provider,
    ID: e.id,
    DisplayName: e.displayName,
    ContextWindow: e.contextWindow,
    MaxOutput: e.maxOutput,
    Reasoning: e.reasoning ?? false,
    Speculative: e.speculative ?? false,
    Source: "static",
  }));
}
