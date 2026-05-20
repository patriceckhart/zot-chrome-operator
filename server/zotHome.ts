import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Resolve the zot data directory (where `auth.json`, `models-cache.json`,
 * `models.json`, sessions and logs live). Mirrors the algorithm in
 * `internal/agent/config.go: ZotHome`.
 */
export function zotHome(): string {
  if (process.env.ZOT_HOME) return process.env.ZOT_HOME;
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "zot");
    case "win32":
      if (process.env.LOCALAPPDATA)
        return path.join(process.env.LOCALAPPDATA, "zot");
      return path.join(home, "AppData", "Local", "zot");
    default: {
      if (process.env.XDG_STATE_HOME)
        return path.join(process.env.XDG_STATE_HOME, "zot");
      return path.join(home, ".local", "state", "zot");
    }
  }
}

/** Subset of `models-cache.json` we consume. Field names match zot's JSON. */
export interface CatalogModel {
  Provider: string;
  ID: string;
  DisplayName?: string;
  ContextWindow?: number;
  MaxOutput?: number;
  Reasoning?: boolean;
  Speculative?: boolean;
  PriceInput?: number;
  PriceOutput?: number;
  BaseURL?: string;
  Source?: string;
}

/** Subset of the user-edited `models.json` we read. */
interface UserModelsFile {
  providers?: Record<
    string,
    {
      models?: {
        id: string;
        name?: string;
        contextWindow?: number;
        maxTokens?: number;
        reasoning?: boolean;
      }[];
    }
  >;
}

/** Subset of `auth.json` we read. */
interface AuthFile {
  [provider: string]:
    | { api_key?: string; oauth?: unknown }
    | unknown
    | undefined;
}

/** Result returned to the webview. */
export interface ModelsSnapshot {
  /** Providers the user has credentials for. */
  authedProviders: string[];
  /**
   * Catalog entries, already filtered to authed providers (+ providers that
   * only appear via `models.json`, which typically don't need auth, e.g.
   * `ollama`).
   */
  models: CatalogModel[];
  /** Raw paths inspected, useful for diagnostics. */
  sources: { auth?: string; cache?: string; custom?: string };
}

/**
 * Read the on-disk model catalog + credentials and produce a snapshot the
 * webview can render directly. Missing files are non-fatal; we degrade to
 * an empty list rather than throwing.
 */
export function readModelsSnapshot(): ModelsSnapshot {
  const home = zotHome();
  const authPath = path.join(home, "auth.json");
  const cachePath = path.join(home, "models-cache.json");
  const customPath = path.join(home, "models.json");

  const authed = readAuthedProviders(authPath);
  const cacheModels = readCatalog(cachePath);
  const customModels = readUserModels(customPath);

  // Merge: cache + user models. The cache already includes user models
  // (zot's startup merges them in) but we union defensively to handle the
  // case where the cache hasn't been refreshed since the user edited
  // models.json. Dedupe by (provider, id).
  const seen = new Set<string>();
  const all: CatalogModel[] = [];
  for (const m of [...cacheModels, ...customModels]) {
    const key = `${m.Provider}::${m.ID}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(m);
  }

  // Filter to providers we can actually use:
  //   - authedProviders ∪ providers from models.json (those are user-defined
  //     local backends, typically auth-less)
  const customProviderSet = new Set(customModels.map((m) => m.Provider));
  const usable = new Set<string>([...authed, ...customProviderSet]);
  const filtered = all.filter((m) => usable.has(m.Provider));

  return {
    authedProviders: authed,
    models: filtered,
    sources: {
      auth: exists(authPath) ? authPath : undefined,
      cache: exists(cachePath) ? cachePath : undefined,
      custom: exists(customPath) ? customPath : undefined,
    },
  };
}

function readAuthedProviders(authPath: string): string[] {
  const data = readJSON<AuthFile>(authPath);
  if (!data) return [];
  const out: string[] = [];
  for (const [provider, value] of Object.entries(data)) {
    if (!value || typeof value !== "object") continue;
    const v = value as { api_key?: string; oauth?: unknown };
    if (v.api_key || v.oauth) out.push(provider);
  }
  return out;
}

function readCatalog(cachePath: string): CatalogModel[] {
  const data = readJSON<{ models?: CatalogModel[] }>(cachePath);
  return Array.isArray(data?.models) ? (data!.models as CatalogModel[]) : [];
}

function readUserModels(customPath: string): CatalogModel[] {
  const data = readJSON<UserModelsFile>(customPath);
  if (!data?.providers) return [];
  const out: CatalogModel[] = [];
  for (const [provider, group] of Object.entries(data.providers)) {
    if (!group?.models) continue;
    for (const m of group.models) {
      out.push({
        Provider: provider,
        ID: m.id,
        DisplayName: m.name || m.id,
        ContextWindow: m.contextWindow,
        MaxOutput: m.maxTokens,
        Reasoning: m.reasoning ?? false,
        Source: "user",
      });
    }
  }
  return out;
}

function readJSON<T>(file: string): T | undefined {
  try {
    const buf = fs.readFileSync(file, "utf8");
    return JSON.parse(buf) as T;
  } catch {
    return undefined;
  }
}

function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

// =====================================================================
// Sessions (extension-owned, per-workspace)
// =====================================================================
//
// Sessions live INSIDE the workspace, under `<workspace>/.zot/sessions/`,
// so they travel with the project. This is intentionally separate from
// zot's own session store (`<ZOT_HOME>/sessions/<sha256(cwd)[:8]>`): the
// RPC mode doesn't persist sessions itself, so the extension is the
// system-of-record for chat history.
//
// File format is a JSONL stream that mirrors zot's on-disk layout so a
// future RPC could load these directly. Each line is one record:
//
//   { "type": "meta",       "meta": { id, cwd, model, provider, started, title? } }
//   { "type": "message",    "message": { role, content[], time } }
//   { "type": "compaction", "messages": […] }   // collapses earlier rows
//   { "type": "rename",     "title": "…" }     // most recent wins
//
// A reader honoring the spec applies the latest `compaction` (replacing
// earlier transcript rows) and the latest `rename`.

export interface SessionSummary {
  /** Absolute path to the .jsonl file, used as a stable identity. */
  path: string;
  /** First message snippet, fallback when no title was set. */
  firstUserText?: string;
  /** Human-set title (from rename), if any. */
  title?: string;
  started?: string;
  model?: string;
  provider?: string;
  /** Logical message count (post-compaction). */
  messageCount: number;
  /** ModTime, used for sorting and "updated 3m ago". */
  mtime: number;
}

export interface SessionTranscriptMessage {
  role: "user" | "assistant" | "system" | string;
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
  /** Effective message list after applying the latest compaction. */
  messages: SessionTranscriptMessage[];
}

/**
 * Per-workspace session directory.
 *
 *   <cwd>/.zot/sessions/
 *
 * Created lazily on first write. Living inside the workspace means the
 * user can `.gitignore` it (or check it in) on a per-project basis.
 */
export function sessionsDir(cwd: string): string {
  return path.join(cwd, ".zot", "sessions");
}

function ensureSessionsDir(cwd: string): string {
  const dir = sessionsDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a brand-new session JSONL with a meta line. Returns the absolute
 * path of the freshly created file. The format intentionally matches zot's
 * own session layout so a future RPC could resume from these files.
 */
export function createSession(opts: {
  cwd: string;
  provider?: string;
  model?: string;
  version?: string;
}): string {
  const dir = ensureSessionsDir(opts.cwd);
  const id = crypto.randomBytes(4).toString("hex");
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..+$/, "");
  const filename = `${stamp}-${id}.jsonl`;
  const p = path.join(dir, filename);
  const meta = {
    type: "meta",
    meta: {
      id,
      cwd: opts.cwd,
      model: opts.model,
      provider: opts.provider,
      started: new Date().toISOString(),
      version: opts.version,
    },
  };
  fs.writeFileSync(p, JSON.stringify(meta) + "\n");
  return p;
}

/**
 * Append one message record to a session file. Each message is a single
 * JSONL line so partial writes never corrupt earlier history.
 */
export function appendSessionMessage(
  sessionPath: string,
  message: { role: string; content: unknown[]; time?: string },
): void {
  const line = JSON.stringify({ type: "message", message }) + "\n";
  fs.appendFileSync(sessionPath, line);
}

/** Update the title field via a `rename` record (idempotent, last-wins). */
export function renameSession(sessionPath: string, title: string): void {
  const line = JSON.stringify({ type: "rename", title }) + "\n";
  fs.appendFileSync(sessionPath, line);
}

/**
 * List sessions for `cwd`, newest first. Parses only the lines needed for
 * a one-line preview — cheap enough to call on every dropdown open.
 */
export function listSessions(cwd: string): SessionSummary[] {
  const dir = sessionsDir(cwd);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SessionSummary[] = [];
  for (const e of entries) {
    if (e.isDirectory()) continue;
    if (!e.name.endsWith(".jsonl")) continue;
    const p = path.join(dir, e.name);
    let mtime = 0;
    try {
      mtime = fs.statSync(p).mtimeMs;
    } catch {
      continue;
    }
    out.push({ ...describeSession(p), path: p, mtime });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function describeSession(p: string): Omit<SessionSummary, "path" | "mtime"> {
  let text: string;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return { messageCount: 0 };
  }
  const sum: Omit<SessionSummary, "path" | "mtime"> = { messageCount: 0 };
  let compactionCount: number | null = null;
  let postCompactionCount = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    switch (row?.type) {
      case "meta":
        if (row.meta) {
          sum.started = row.meta.started;
          sum.model = row.meta.model;
          sum.provider = row.meta.provider;
          if (row.meta.title) sum.title = row.meta.title;
        }
        break;
      case "message":
        sum.messageCount += 1;
        if (compactionCount !== null) postCompactionCount += 1;
        if (!sum.firstUserText) {
          sum.firstUserText = firstUserText(row.message);
        }
        break;
      case "compaction":
        compactionCount = Array.isArray(row.messages) ? row.messages.length : 0;
        postCompactionCount = 0;
        break;
      case "rename":
        if (typeof row.title === "string") sum.title = row.title;
        break;
    }
  }
  if (compactionCount !== null) {
    sum.messageCount = compactionCount + postCompactionCount;
  }
  return sum;
}

function firstUserText(message: any): string | undefined {
  if (message?.role !== "user") return undefined;
  if (!Array.isArray(message.content)) return undefined;
  for (const block of message.content) {
    if (block?.type === "text" && typeof block.text === "string") {
      return block.text.slice(0, 160);
    }
  }
  return undefined;
}

/**
 * Read a full session transcript, applying the latest compaction so the
 * caller sees the effective message list. Used when the user picks a
 * session in the dropdown — we hydrate the webview with its transcript.
 *
 * The RPC subprocess is unaffected by this; switching sessions in our UI
 * is purely a presentation concern (RPC mode has no session-load command).
 * Future prompts continue against a fresh server-side memory.
 */
export function readSessionTranscript(sessionPath: string): SessionTranscript {
  let text: string;
  try {
    text = fs.readFileSync(sessionPath, "utf8");
  } catch {
    return { messages: [] };
  }
  let meta: SessionTranscript["meta"];
  let preCompaction: SessionTranscriptMessage[] = [];
  let compaction: SessionTranscriptMessage[] | null = null;
  let postCompaction: SessionTranscriptMessage[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    switch (row?.type) {
      case "meta":
        if (row.meta) meta = { ...meta, ...row.meta };
        break;
      case "message":
        if (row.message) {
          if (compaction !== null) postCompaction.push(row.message);
          else preCompaction.push(row.message);
        }
        break;
      case "compaction":
        if (Array.isArray(row.messages)) {
          compaction = row.messages;
          postCompaction = [];
        }
        break;
      case "rename":
        if (typeof row.title === "string")
          meta = { ...(meta ?? {}), title: row.title };
        break;
    }
  }
  const messages =
    compaction !== null ? [...compaction, ...postCompaction] : preCompaction;
  return { meta, messages };
}

/** Permanently delete a session file. Returns true on success. */
export function deleteSession(sessionPath: string): boolean {
  try {
    fs.unlinkSync(sessionPath);
    return true;
  } catch {
    return false;
  }
}
