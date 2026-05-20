import { useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  Circle,
  Cpu,
  Paperclip,
  X,
  Image as ImageIcon,
  FileText,
  Upload,
} from "lucide-react";
import { useChat } from "./chat/useChat";
import { MessageBubble } from "./chat/MessageBubble";
import { ModelPicker } from "./chat/ModelPicker";
import { SessionsHeader } from "./chat/SessionsHeader";
import { AnimatedZ } from "./components/AnimatedZ";
import { vscode } from "./lib/vscode";
import { cn } from "./lib/utils";
import type { PromptAttachment } from "./chat/types";

/**
 * Layout (top → bottom):
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ SessionsHeader  (sticky)                      │  ← session switcher + actions
 *   ├──────────────────────────────────────────────┤
 *   │ Transcript / EmptyState                       │  ← scrolls
 *   ├──────────────────────────────────────────────┤
 *   │ ModelPicker  thinking?  cost                  │  ← toolbar (above input)
 *   │ ┌───────────────────────────────────────┐    │
 *   │ │ [attach]  Message zot…       [send/×] │    │  ← composer
 *   │ └───────────────────────────────────────┘    │
 *   └──────────────────────────────────────────────┘
 *
 * The empty state (animated Z + suggestions) is rendered as an absolutely
 * positioned overlay inside the transcript area so it sits in the geometric
 * centre regardless of header/composer heights.
 */
export function App() {
  const {
    messages,
    state,
    busy,
    models,
    sessions,
    activeSessionPath,
    sendPrompt,
    abort,
    selectModel,
    loadSession,
    deleteSession,
  } = useChat();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Global drag-and-drop: any file dragged anywhere into the webview is
   * attached to the next prompt. VS Code often does not expose dropped files
   * through `dataTransfer.files`; in that case it provides `text/uri-list`
   * or a plain file path. We send those paths to the extension host, which
   * can read the files via Node and send back normal PromptAttachment data.
   */
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      if (hideTimer) clearTimeout(hideTimer);
      setDragActive(true);
    };
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      show();
    };
    const onLeave = (_e: DragEvent) => {
      // Electron fires dragleave constantly while moving over child elements.
      // Keep the overlay stable; it is hidden on drop or when dragend fires.
    };
    const onOver = (e: DragEvent) => {
      // Always prevent default during dragover. Some VS Code/Electron builds
      // expose no DataTransfer types until the actual drop; if we gate this,
      // Chromium rejects the drop before files become readable.
      e.preventDefault();
      show();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (hideTimer) clearTimeout(hideTimer);
      setDragActive(false);

      // Prefer path/URI payloads when VS Code provides them: Explorer drags
      // can expose fake/empty File objects, while the extension host can read
      // the real file path reliably.
      const paths = pathsFromDataTransfer(e.dataTransfer);
      if (paths.length > 0) {
        vscode().postMessage({ kind: "attach_paths", payload: { paths } });
        return;
      }

      const out: PromptAttachment[] = [];
      for (const f of filesFromDataTransfer(e.dataTransfer)) {
        const a = await fileToAttachment(f);
        if (a) out.push(a);
      }
      if (out.length > 0) {
        setAttachments((prev) => [...prev, ...out]);
        return;
      }

      // Some VS Code webview/Electron builds show drag events but expose no
      // readable File/path payload on drop. Fall back to the native VS Code
      // file picker so the user action still results in an attachment instead
      // of silently doing nothing.
      vscode().postMessage({
        kind: "pick_attachments",
        payload: { reason: "empty-drop" },
      });
    };
    const onDragEnd = () => setDragActive(false);

    const targets: Array<Window | Document> = [window, document];
    for (const target of targets) {
      target.addEventListener("dragenter", onEnter as EventListener, true);
      target.addEventListener("dragleave", onLeave as EventListener, true);
      target.addEventListener("dragover", onOver as EventListener, true);
      target.addEventListener("drop", onDrop as EventListener, true);
      target.addEventListener("dragend", onDragEnd as EventListener, true);
    }
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      for (const target of targets) {
        target.removeEventListener("dragenter", onEnter as EventListener, true);
        target.removeEventListener("dragleave", onLeave as EventListener, true);
        target.removeEventListener("dragover", onOver as EventListener, true);
        target.removeEventListener("drop", onDrop as EventListener, true);
        target.removeEventListener("dragend", onDragEnd as EventListener, true);
      }
    };
  }, []);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.kind === "attachments_loaded") {
        const incoming = msg.payload?.attachments as
          | PromptAttachment[]
          | undefined;
        if (incoming?.length) setAttachments((prev) => [...prev, ...incoming]);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Auto-scroll on new content. The Radix viewport is the scroll container;
  // writing to a child div does nothing because the child doesn't overflow.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Autosize the textarea up to ~6 lines.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (!draft.trim()) {
      el.style.height = "44px";
      return;
    }
    el.style.height = "auto";
    el.style.height = Math.max(44, Math.min(el.scrollHeight, 160)) + "px";
  }, [draft]);

  function submit() {
    if (busy) return;
    if (!draft.trim() && attachments.length === 0) return;
    sendPrompt(draft, attachments);
    setDraft("");
    setAttachments([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function newSession() {
    vscode().postMessage({ kind: "new_session" });
    setAttachments([]);
    setDraft("");
  }

  const streamingId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.pending) return m.id;
      if (m.role === "user") break;
    }
    return null;
  }, [messages]);

  const isEmpty = messages.length === 0;

  return (
    // `h-full` (not `h-screen`) so the layout matches the actual webview
    // iframe height. `h-screen` resolves to 100vh which in VS Code can be
    // taller than the visible panel, pushing the composer off-screen and
    // making the transcript appear to overlap with it.
    <div className="relative flex h-full w-screen max-w-none flex-col overflow-hidden">
      {dragActive && <GlobalDropOverlay />}
      <SessionsHeader
        sessions={sessions}
        activeSessionPath={activeSessionPath}
        onSelect={loadSession}
        onDelete={deleteSession}
        onNewSession={newSession}
      />

      {/*
        Transcript region. Must be `flex-1 min-h-0` so flexbox actually
        shrinks it (default flex children won't go below their content
        height — `min-h-0` lifts that constraint), and `overflow-hidden`
        so the ScrollArea inside it sees a bounded viewport. We use a
        plain native scroller here instead of Radix's ScrollArea because
        Radix's Viewport relies on internal layout tricks that don't play
        nicely with deeply-nested flex children inside a VS Code webview,
        which was causing the transcript to overflow into the composer.
      */}
      {isEmpty ? (
        // Empty state: ordinary flex child that grows to fill remaining
        // space (between header and composer) and centres its content.
        // Crucially `overflow-hidden` so the animated Z + suggestion cards
        // never push the composer below the visible area.
        <div className="flex flex-1 min-h-0 items-center justify-center overflow-hidden">
          <EmptyState onPick={(p) => setDraft(p)} />
        </div>
      ) : (
        <div
          ref={viewportRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        >
          <div className="flex flex-col gap-3 px-3 py-4">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                streaming={m.id === streamingId}
              />
            ))}
          </div>
        </div>
      )}

      <div className="w-screen max-w-none px-3 pb-3 pt-2">
        <Toolbar
          provider={state.provider}
          model={state.model}
          cost={state.usage?.cost_usd}
          busy={busy}
          models={models?.models ?? []}
          modelsLoading={!models}
          onSelectModel={selectModel}
        />
        <Composer
          textareaRef={taRef}
          value={draft}
          onChange={setDraft}
          onKeyDown={onKeyDown}
          onSubmit={submit}
          onAbort={abort}
          busy={busy}
          attachments={attachments}
          onAttach={(a) => setAttachments((prev) => [...prev, ...a])}
          onRemoveAttachment={(i) =>
            setAttachments((prev) => prev.filter((_, idx) => idx !== i))
          }
        />
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "Summarize the current page",
  "Open Gmail and check my latest unread emails",
  "Search Amazon for Apple Watch Ultra 3",
  "Find the best-rated restaurants near me",
];

/**
 * Vertically + horizontally centred hero shown when the transcript is empty.
 * Lives inside the transcript area (absolute fill) so it always renders in
 * the optical middle of the visible space.
 */
function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-5 px-4 text-center">
      <div className="relative">
        <div className="absolute inset-0 -z-10 blur-2xl opacity-60">
          <AnimatedZ size={96} />
        </div>
        <AnimatedZ size={72} />
      </div>
      <div className="my-5 w-full space-y-1.5">
        <p className="text-xs text-muted-foreground">
          Ask zot to browse, search, summarize, or fill forms. <br />
          Press <Kbd>Enter</Kbd> to send,
          <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a newline.
        </p>
      </div>
      <div className="flex w-full flex-col gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="group flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-card hover:text-foreground"
          >
            <span>{s}</span>
            <span className="opacity-0 transition-opacity group-hover:opacity-100 text-primary">
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Full-extension overlay shown while a file drag is in progress. Rendered
 * outside the normal flow with `absolute inset-0` and a high z-index so it
 * covers the header, transcript, composer, and toolbar in one sheet.
 *
 * `pointer-events-none` is critical: if the overlay swallowed pointer
 * events it would steal the `drop` from the window listener and the files
 * would never reach `fileToAttachment`. The visual layer is decorative
 * only; the actual drop is handled at the window level.
 */
function GlobalDropOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      aria-hidden
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 bg-card/80 px-8 py-6 text-center shadow-[0_0_60px_-10px_hsl(var(--zot-glow))]">
        <Upload className="h-8 w-8 text-primary" />
        <div className="font-sans text-sm font-semibold text-foreground">
          Drop to attach
        </div>
        <div className="text-[11px] text-muted-foreground">
          Files become attachments on the next prompt.
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border/70 bg-secondary px-1 py-px font-mono text-[10px] text-foreground/80">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/* Toolbar                                                            */
/* ------------------------------------------------------------------ */

function Toolbar({
  provider,
  model,
  cost,
  busy,
  models,
  modelsLoading,
  onSelectModel,
}: {
  provider?: string;
  model?: string;
  cost?: number;
  busy: boolean;
  models: import("./chat/types").CatalogModel[];
  modelsLoading: boolean;
  onSelectModel: (provider: string, model: string) => void;
}) {
  return (
    <div className="mb-1.5 flex flex-row items-center gap-2">
      <ModelPicker
        models={models}
        currentProvider={provider}
        currentModel={model}
        loading={modelsLoading}
        onSelect={onSelectModel}
      />
      <div className="ml-auto flex items-center gap-2">
        {busy && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">
            <Cpu className="h-2.5 w-2.5" />
            thinking
          </span>
        )}
        {cost != null && cost > 0 && (
          <span
            title="Cumulative cost this session"
            className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums"
          >
            ${cost.toFixed(4)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Composer + attachments                                             */
/* ------------------------------------------------------------------ */

const IMAGE_MIME_PREFIX = "image/";
const TEXTUAL_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "go",
  "rs",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "scala",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "html",
  "css",
  "scss",
  "vue",
  "svelte",
  "sh",
  "bash",
  "zsh",
  "fish",
  "sql",
  "graphql",
  "proto",
  "dockerfile",
  "env",
  "gitignore",
  "csv",
  "tsv",
  "log",
]);

function isImageMime(mime: string) {
  return mime.startsWith(IMAGE_MIME_PREFIX);
}

function isTextual(file: File) {
  if (file.type.startsWith("text/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXTUAL_EXTENSIONS.has(ext);
}

async function fileToAttachment(file: File): Promise<PromptAttachment | null> {
  // Cap individual files to keep prompts and webview memory sane.
  const MAX = 4 * 1024 * 1024; // 4 MB
  if (file.size > MAX) return null;

  if (file.type && isImageMime(file.type)) {
    const buf = await file.arrayBuffer();
    return {
      kind: "image",
      name: file.name,
      mimeType: file.type,
      base64: arrayBufferToBase64(buf),
      bytes: file.size,
    };
  }
  if (isTextual(file)) {
    const text = await file.text();
    return {
      kind: "text",
      name: file.name,
      text,
      bytes: file.size,
    };
  }
  // Unknown binary: still attach visibly instead of silently dropping it.
  return {
    kind: "text",
    name: file.name,
    text: `[Binary file omitted: ${file.name}, ${file.size} bytes]`,
    bytes: file.size,
  };
}

function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files = Array.from(dt.files ?? []);
  if (files.length > 0) return files;
  const out: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

function pathsFromDataTransfer(dt: DataTransfer | null): string[] {
  if (!dt) return [];

  // VS Code's explorer/editor drags do not consistently expose `Files`.
  // Depending on source/version they arrive as CodeFiles, text/uri-list,
  // text/plain, or an application/vnd.code.tree.* JSON payload. Read every
  // available MIME type and recursively pull out file-looking strings.
  const rawParts: string[] = [];
  for (const type of Array.from(dt.types ?? [])) {
    try {
      const value = dt.getData(type);
      if (value) rawParts.push(value);
    } catch {
      // Some internal drag formats are not readable from webviews.
    }
  }

  const out = new Set<string>();
  for (const raw of rawParts) {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      for (const path of extractPathLikeValues(trimmed)) out.add(path);
    }
  }
  return Array.from(out);
}

function extractPathLikeValues(value: unknown): string[] {
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];

    try {
      return extractPathLikeValues(JSON.parse(s));
    } catch {
      // Not JSON; treat as a candidate below.
    }

    if (
      s.startsWith("file:") ||
      s.startsWith("/") ||
      s.startsWith("~/") ||
      /^[A-Za-z]:[\\/]/.test(s)
    ) {
      return [s];
    }
    return [];
  }

  if (Array.isArray(value)) return value.flatMap(extractPathLikeValues);

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const preferred = [
      obj.fsPath,
      obj.path,
      obj.uri,
      obj.resource,
      obj.resources,
      obj.files,
    ].flatMap(extractPathLikeValues);
    const nested = Object.values(obj).flatMap(extractPathLikeValues);
    return [...preferred, ...nested];
  }

  return [];
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  // Chunked to avoid argument-length explosions on big files.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(bin);
}

function Composer({
  value,
  onChange,
  onKeyDown,
  onSubmit,
  onAbort,
  busy,
  textareaRef,
  attachments,
  onAttach,
  onRemoveAttachment,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  onAbort: () => void;
  busy: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  attachments: PromptAttachment[];
  onAttach: (a: PromptAttachment[]) => void;
  onRemoveAttachment: (index: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  async function ingest(files: FileList | File[] | null) {
    if (!files) return;
    const arr = Array.from(files);
    const out: PromptAttachment[] = [];
    for (const f of arr) {
      const a = await fileToAttachment(f);
      if (a) out.push(a);
    }
    if (out.length > 0) onAttach(out);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    void ingest(filesFromDataTransfer(e.dataTransfer));
  }

  return (
    <div
      className={cn(
        "zot-composer rounded-xl p-2 transition-colors",
        dragOver && "ring-2 ring-primary/60",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <AttachmentChip
              key={`${a.name}-${i}`}
              attachment={a}
              onRemove={() => onRemoveAttachment(i)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <ActionCardButton
          tone="primary"
          title="Attach files or images"
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
        </ActionCardButton>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,text/*,.md,.json,.yaml,.yml,.toml,.ts,.tsx,.js,.jsx,.go,.rs,.py,.rb,.php,.java,.c,.h,.cc,.cpp,.hpp,.cs,.html,.css,.scss,.sh,.sql,.graphql,.proto,.csv,.tsv,.log,.env,.gitignore,.dockerfile"
          className="hidden"
          onChange={(e) => {
            void ingest(e.target.files);
            e.target.value = "";
          }}
        />
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? "Queue another message…" : "Message zot"}
          rows={1}
          className="h-11 min-h-11 max-h-[160px] resize-none overflow-y-auto border-0 bg-transparent px-2 py-3 text-[13px] leading-5 shadow-none focus-visible:ring-0"
        />
        {busy ? (
          <ActionCardButton tone="destructive" title="Abort" onClick={onAbort}>
            <Circle className="h-4 w-4" />
          </ActionCardButton>
        ) : (
          <ActionCardButton
            tone="primary"
            title="Send (Enter)"
            onClick={onSubmit}
            disabled={!value.trim() && attachments.length === 0}
          >
            <Send className="h-4 w-4" />
          </ActionCardButton>
        )}
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PromptAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.kind === "image";
  return (
    <div className="group inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border/60 bg-secondary/60 px-1.5 py-1 text-[11px] text-foreground">
      {isImage ? (
        <ImageIcon className="h-3 w-3 shrink-0 text-primary" />
      ) : (
        <FileText className="h-3 w-3 shrink-0 text-primary" />
      )}
      <span className="truncate" title={attachment.name}>
        {attachment.name}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {formatBytes(attachment.bytes)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-destructive/30 hover:text-destructive"
        title="Remove"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + "kB";
  return (n / 1024 / 1024).toFixed(1) + "MB";
}

/**
 * Square icon button styled to match the prompt-suggestion cards in the
 * empty state: subtle bordered "card" face that lights up on hover. Two
 * tones:
 *   - `primary`     cyan hover (used by send)
 *   - `destructive` red hover  (used by stop)
 *
 * Kept visually distinct from the surrounding chrome (paperclip, model
 * picker) so the primary action remains the obvious target without resorting
 * to a saturated background fill.
 */
function ActionCardButton({
  tone,
  title,
  onClick,
  disabled,
  children,
}: {
  tone: "primary" | "destructive";
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // Base — mirrors the suggestion-card chrome (border, bg, transition).
        "group flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-card/50 transition-colors disabled:opacity-40 disabled:pointer-events-none",
        tone === "primary" &&
          "border-border/60 text-muted-foreground hover:border-primary/50 hover:bg-card hover:text-primary",
        tone === "destructive" &&
          "border-destructive/40 text-destructive/80 hover:border-destructive/70 hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}
