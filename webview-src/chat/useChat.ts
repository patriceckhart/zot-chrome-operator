import { useCallback, useEffect, useRef, useState } from "react";
import { vscode } from "@/lib/vscode";
import type {
  AgentState,
  ChatMessage,
  ModelsSnapshot,
  PromptAttachment,
  SessionSummary,
  SessionTranscript,
  SessionTranscriptMessage,
} from "./types";

/**
 * Reduces the RPC event stream into a flat list of chat bubbles plus a
 * snapshot of agent state. The reducer is intentionally permissive: unknown
 * fields are ignored, malformed events are logged.
 */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<AgentState>({});
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ModelsSnapshot | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionPath, setActiveSessionPath] = useState<string | null>(
    null,
  );
  const assistantIdRef = useRef<string | null>(null);
  const browserContextInjectedRef = useRef(false);
  const suppressRpcErrorsUntilRef = useRef(0);
  const counterRef = useRef(0);

  const newId = useCallback((prefix: string) => {
    counterRef.current += 1;
    return `${prefix}-${counterRef.current}`;
  }, []);

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateMessage = useCallback(
    (id: string, patch: Partial<ChatMessage>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      );
    },
    [],
  );

  const handleFrame = useCallback(
    (frame: any) => {
      if (!frame || typeof frame !== "object") return;

      // Command responses: piggy-back on get_state to hydrate the header.
      if (
        frame.type === "response" &&
        frame.command === "get_state" &&
        frame.data
      ) {
        setState((s) => ({ ...s, ...frame.data }));
        setBusy(Boolean(frame.data.busy));
        return;
      }
      if (
        frame.type === "response" &&
        frame.command === "hello" &&
        frame.data
      ) {
        setState((s) => ({
          ...s,
          provider: frame.data.provider,
          model: frame.data.model,
        }));
        return;
      }
      if (
        frame.type === "response" &&
        frame.command === "set_model" &&
        frame.data
      ) {
        setState((s) => ({ ...s, model: frame.data.model }));
        return;
      }

      switch (frame.type) {
        case "user_message": {
          // Echoed by the agent when our prompt is committed to the
          // transcript. We've already shown an optimistic bubble, so skip
          // unless we somehow missed it.
          return;
        }
        case "assistant_start": {
          const id = newId("assistant");
          assistantIdRef.current = id;
          appendMessage({ id, role: "assistant", text: "", pending: true });
          return;
        }
        case "text_delta": {
          const id = assistantIdRef.current;
          if (!id) {
            // Some providers may emit text_delta without assistant_start.
            const fresh = newId("assistant");
            assistantIdRef.current = fresh;
            appendMessage({
              id: fresh,
              role: "assistant",
              text: String(frame.delta || ""),
              pending: true,
            });
            return;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, text: m.text + (frame.delta || "") } : m,
            ),
          );
          return;
        }
        case "assistant_message": {
          const id = assistantIdRef.current;
          if (id) updateMessage(id, { pending: false });
          assistantIdRef.current = null;
          return;
        }
        case "tool_call": {
          const id = `tool-${frame.id || newId("call")}`;
          appendMessage({
            id,
            role: "tool",
            tool: frame.name,
            text: formatToolArgs(frame.args),
            pending: true,
          });
          return;
        }
        case "tool_progress": {
          const id = `tool-${frame.id}`;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? { ...m, text: m.text + "\n" + (frame.text || "") }
                : m,
            ),
          );
          return;
        }
        case "tool_result": {
          const id = `tool-${frame.id}`;
          const summary = summariseToolContent(frame.content);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? {
                    ...m,
                    pending: false,
                    isError: Boolean(frame.is_error),
                    text: m.text + (summary ? "\n→ " + summary : ""),
                  }
                : m,
            ),
          );
          return;
        }
        case "usage": {
          setState((s) => ({ ...s, usage: frame.cumulative || frame }));
          return;
        }
        case "turn_start": {
          setBusy(true);
          return;
        }
        case "turn_end": {
          // Not "done" yet: the agent may loop for more steps.
          return;
        }
        case "done": {
          setBusy(false);
          assistantIdRef.current = null;
          return;
        }
        case "error": {
          // Model/provider switches can race with the old rpc process and emit
          // transient errors/exits. Do not surface those as chat content.
          if (Date.now() < suppressRpcErrorsUntilRef.current) return;
          appendMessage({
            id: newId("err"),
            role: "system",
            text: String(frame.message || "unknown error"),
            isError: true,
          });
          return;
        }
        case "compact_done": {
          appendMessage({
            id: newId("compact"),
            role: "system",
            text: `Conversation compacted:\n${frame.summary || ""}`,
          });
          return;
        }
      }
    },
    [appendMessage, newId, updateMessage],
  );

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      switch (msg.kind) {
        case "frame":
          handleFrame(msg.payload);
          return;
        case "status":
          if (msg.payload?.state === "exited") {
            setBusy(false);
            if (Date.now() < suppressRpcErrorsUntilRef.current) return;
            appendMessage({
              id: newId("sys"),
              role: "system",
              text: `zot rpc exited (code=${msg.payload.code ?? "?"})`,
              isError: true,
            });
          } else if (msg.payload?.state === "new-session") {
            setMessages([]);
            setActiveSessionPath(null);
            browserContextInjectedRef.current = false;
            return;
          } else if (msg.payload?.state === "restarted") {
            // Optimistically update the visible model + provider so the picker
            // reflects the choice before the new process emits its hello.
            if (msg.payload.provider || msg.payload.model) {
              setState((s) => ({
                ...s,
                provider: msg.payload.provider ?? s.provider,
                model: msg.payload.model ?? s.model,
              }));
            }
            appendMessage({
              id: newId("sys"),
              role: "system",
              text:
                msg.payload.reason === "provider-switch"
                  ? `Switched to ${msg.payload.model} on ${msg.payload.provider}. Conversation reset.`
                  : "Agent restarted.",
            });
          }
          return;
        case "models":
          setModels(msg.payload as ModelsSnapshot);
          return;
        case "sessions":
          setSessions(
            (msg.payload?.sessions as SessionSummary[] | undefined) ?? [],
          );
          return;
        case "session_loaded": {
          const path = msg.payload?.path as string | undefined;
          const transcript = msg.payload?.transcript as
            | SessionTranscript
            | undefined;
          if (!transcript) return;
          setActiveSessionPath(path ?? null);
          // Replace the visible transcript with the saved one. We hydrate
          // synchronously — the RPC subprocess is untouched, so new prompts
          // will continue against a fresh server-side memory.
          setMessages(transcriptToMessages(transcript.messages, newId));
          if (transcript.meta?.model || transcript.meta?.provider) {
            setState((s) => ({
              ...s,
              model: transcript.meta?.model ?? s.model,
              provider: transcript.meta?.provider ?? s.provider,
            }));
          }
          return;
        }
        case "stderr":
          // Discard by default; uncomment for debugging.
          // console.log("[zot stderr]", msg.payload);
          return;
      }
    }
    window.addEventListener("message", onMessage);
    vscode().postMessage({ kind: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [appendMessage, handleFrame, newId]);

  const sendPrompt = useCallback(
    (text: string, attachments?: PromptAttachment[]) => {
      const trimmed = text.trim();
      // Inline text-file attachments into the prompt body as fenced blocks
      // so the model sees them as part of the user message. Images go on
      // the wire as `images: [{ mime_type, data }]` per the RPC contract.
      const inlineParts: string[] = [];
      const images: { mime_type: string; data: string }[] = [];
      for (const a of attachments ?? []) {
        if (a.kind === "image") {
          images.push({ mime_type: a.mimeType, data: a.base64 });
        } else {
          inlineParts.push(`\n\n\`\`\`${a.name}\n${a.text}\n\`\`\``);
        }
      }
      const fullMessage = (trimmed + inlineParts.join("")).trim();
      if (!fullMessage && images.length === 0) return;

      const browserContext = `\n\n[Browser operator instructions]\nYou are operating inside Chrome. Use the browser_action tool for browser tasks. Available actions: list_tabs, get_tab_context, navigate, click, type, select, scroll, extract, new_tab, switch_tab, close_tab, wait. For website tasks, inspect with get_tab_context before interacting and verify changes after actions.`;
      const messageWithBrowserContext = browserContextInjectedRef.current
        ? fullMessage
        : `${fullMessage}${browserContext}`;
      browserContextInjectedRef.current = true;

      // Build a single visible bubble that shows the user's typed text plus
      // an attachment summary line, so they can see what was actually sent.
      const attachmentSummary =
        (attachments?.length ?? 0) > 0
          ? "\n\n" +
            (attachments ?? [])
              .map((a) =>
                a.kind === "image" ? `[image: ${a.name}]` : `[file: ${a.name}]`,
              )
              .join("  \u00b7  ")
          : "";
      appendMessage({
        id: newId("user"),
        role: "user",
        text: trimmed + attachmentSummary,
      });
      setBusy(true);
      vscode().postMessage({
        kind: "rpc",
        payload: {
          type: "prompt",
          message: messageWithBrowserContext,
          ...(images.length > 0 ? { images } : {}),
        },
      });
    },
    [appendMessage, newId],
  );

  const abort = useCallback(() => {
    vscode().postMessage({ kind: "rpc", payload: { type: "abort" } });
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    vscode().postMessage({ kind: "rpc", payload: { type: "clear" } });
  }, []);

  const restart = useCallback(() => {
    setMessages([]);
    vscode().postMessage({ kind: "restart" });
  }, []);

  const selectModel = useCallback((provider: string, model: string) => {
    // Optimistic local update; the host echoes the final value via the
    // `set_model` response or via `status: restarted` for cross-provider swaps.
    suppressRpcErrorsUntilRef.current = Date.now() + 4000;
    setState((s) => ({ ...s, provider, model }));
    vscode().postMessage({
      kind: "select_model",
      payload: { provider, model },
    });
  }, []);

  const refreshModels = useCallback(() => {
    vscode().postMessage({ kind: "list_models" });
  }, []);

  const refreshSessions = useCallback(() => {
    vscode().postMessage({ kind: "list_sessions" });
  }, []);

  const loadSession = useCallback((path: string) => {
    vscode().postMessage({ kind: "load_session", payload: { path } });
  }, []);

  const deleteSession = useCallback(
    (path: string) => {
      if (path === activeSessionPath) {
        setMessages([]);
        setActiveSessionPath(null);
        setBusy(false);
      }
      vscode().postMessage({ kind: "delete_session", payload: { path } });
    },
    [activeSessionPath],
  );

  return {
    messages,
    state,
    busy,
    models,
    sessions,
    activeSessionPath,
    sendPrompt,
    abort,
    clear,
    restart,
    selectModel,
    refreshModels,
    refreshSessions,
    loadSession,
    deleteSession,
  };
}

/**
 * Convert a saved transcript (zot's on-disk message rows) into our
 * ChatMessage[] shape. Tool calls and tool results are flattened into
 * `tool`-role bubbles so the historical view matches a live one.
 */
function transcriptToMessages(
  msgs: SessionTranscriptMessage[],
  newId: (prefix: string) => string,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of msgs) {
    const blocks = Array.isArray(m.content) ? m.content : [];
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      switch (block.type) {
        case "text":
          if (typeof block.text !== "string" || !block.text.trim()) break;
          out.push({
            id: newId(m.role),
            role: m.role === "assistant" ? "assistant" : "user",
            text: block.text,
          });
          break;
        case "tool_call":
          out.push({
            id: `tool-${block.id || newId("call")}`,
            role: "tool",
            tool: block.name,
            text: safeStringify(block.args),
          });
          break;
        case "tool_result": {
          const id = `tool-${block.call_id || newId("res")}`;
          const summary = summariseContent(block.content);
          // Try to append to a preceding tool_call bubble; otherwise emit
          // a standalone tool entry.
          const prior = out.find((x) => x.id === id);
          if (prior) {
            prior.text = prior.text + (summary ? "\n→ " + summary : "");
            prior.isError = Boolean(block.is_error);
          } else {
            out.push({
              id,
              role: "tool",
              tool: "result",
              text: summary,
              isError: Boolean(block.is_error),
            });
          }
          break;
        }
        case "image":
          out.push({
            id: newId(m.role),
            role: m.role === "assistant" ? "assistant" : "user",
            text: `[image ${block.bytes ?? "?"}b]`,
          });
          break;
      }
    }
  }
  return out;
}

function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v, null, 2);
    return s.length > 400 ? s.slice(0, 400) + "…" : s;
  } catch {
    return String(v);
  }
}

function summariseContent(content: any): string {
  if (!Array.isArray(content)) return "";
  const text = content
    .map((b) => {
      if (b?.type === "text") return b.text;
      if (b?.type === "image") return `[image ${b.bytes ?? "?"}b]`;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return text.length > 400 ? text.slice(0, 400) + "…" : text;
}

function formatToolArgs(args: unknown): string {
  if (args == null) return "";
  try {
    const json = JSON.stringify(args, null, 2);
    return json.length > 400 ? json.slice(0, 400) + "…" : json;
  } catch {
    return String(args);
  }
}

function summariseToolContent(content: any): string {
  if (!Array.isArray(content)) return "";
  const text = content
    .map((block) => {
      if (block?.type === "text") return block.text;
      if (block?.type === "image") return `[image ${block.bytes ?? "?"}b]`;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) return "";
  return text.length > 400 ? text.slice(0, 400) + "…" : text;
}
