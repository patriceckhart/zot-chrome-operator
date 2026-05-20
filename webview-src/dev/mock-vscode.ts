/**
 * Browser-only mock of the VS Code webview bridge.
 *
 * In a real VS Code webview the host injects `acquireVsCodeApi()` and the
 * extension forwards `zot rpc` frames via `window.postMessage`. When the
 * webview is loaded by `vite dev` (i.e. plain http://localhost:5173) neither
 * exists, so we install:
 *
 *   1. A fake `acquireVsCodeApi` whose `postMessage` interprets our wire
 *      protocol (`{ kind: "rpc" | "ready" | "restart", payload }`) and
 *      synthesises plausible responses.
 *   2. A small scripted "agent" that streams a fake assistant reply,
 *      emits a couple of tool calls, and a usage frame, so every code
 *      path in `useChat` lights up.
 *
 * Production: the production Vite bundle never loads this file (it lives
 * only in `index.html`, which the extension host doesn't ship — the
 * extension provides its own HTML in `chatView.ts`).
 */

type VsCodeApi = {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): void;
};

declare global {
  // eslint-disable-next-line no-var
  var acquireVsCodeApi: () => VsCodeApi;
}

// `import.meta.env.DEV` is statically `true` in `vite dev` and `false` in
// `vite build` — the entire block below is dead-code-eliminated from the
// production bundle.
if (import.meta.env.DEV && typeof window !== "undefined" && !("acquireVsCodeApi" in window)) {
  let state: unknown = undefined;

  const post = (msg: unknown) => {
    // Match VS Code's message dispatch: a `message` event on window
    // with the frame as `event.data`.
    window.dispatchEvent(new MessageEvent("message", { data: msg }));
  };

  const api: VsCodeApi = {
    postMessage: (msg) => handleOutbound(msg),
    getState: () => state as never,
    setState: (s) => {
      state = s;
    },
  };

  (window as unknown as { acquireVsCodeApi: () => VsCodeApi }).acquireVsCodeApi =
    () => api;

  /** Outbound = webview → extension. We answer as the extension would. */
  function handleOutbound(msg: any) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.kind) {
      case "ready":
        // Mirror what the real host does: send a state snapshot.
        post({
          kind: "frame",
          payload: {
            type: "response",
            command: "get_state",
            success: true,
            data: {
              provider: currentProvider,
              model: currentModel,
              cwd: "/tmp/mock-workspace",
              busy: false,
              usage: { input: 0, output: 0, cost_usd: 0 },
            },
          },
        });
        post({ kind: "models", payload: MOCK_MODELS });
        post({ kind: "sessions", payload: { sessions: MOCK_SESSIONS } });
        return;
      case "rpc":
        handleRpc(msg.payload);
        return;
      case "restart":
        post({ kind: "status", payload: { state: "restarted" } });
        return;
      case "list_models":
        post({ kind: "models", payload: MOCK_MODELS });
        return;
      case "list_sessions":
        post({ kind: "sessions", payload: { sessions: MOCK_SESSIONS } });
        return;
      case "load_session": {
        const path = msg.payload?.path as string | undefined;
        if (!path) return;
        const s = MOCK_SESSIONS.find((x) => x.path === path);
        post({
          kind: "session_loaded",
          payload: {
            path,
            transcript: {
              meta: { model: s?.model, provider: s?.provider, title: s?.title },
              messages: [
                {
                  role: "user",
                  content: [{ type: "text", text: s?.firstUserText ?? "Hi." }],
                },
                {
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text: "This is a previously-recorded reply restored from the session file.",
                    },
                  ],
                },
              ],
            },
          },
        });
        return;
      }
      case "delete_session": {
        const path = msg.payload?.path as string | undefined;
        const idx = MOCK_SESSIONS.findIndex((x) => x.path === path);
        if (idx >= 0) MOCK_SESSIONS.splice(idx, 1);
        post({ kind: "sessions", payload: { sessions: MOCK_SESSIONS } });
        return;
      }
      case "new_session":
        post({ kind: "status", payload: { state: "new-session" } });
        return;
      case "select_model": {
        const p = msg.payload?.provider as string | undefined;
        const m = msg.payload?.model as string | undefined;
        if (!p || !m) return;
        if (p === currentProvider) {
          currentModel = m;
          post({
            kind: "frame",
            payload: {
              type: "response",
              command: "set_model",
              success: true,
              data: { model: m },
            },
          });
        } else {
          currentProvider = p;
          currentModel = m;
          post({
            kind: "status",
            payload: {
              state: "restarted",
              reason: "provider-switch",
              provider: p,
              model: m,
            },
          });
        }
        return;
      }
    }
  }

  let currentProvider = "anthropic";
  let currentModel = "claude-opus-4-5";

  const NOW = Date.now();
  const MOCK_SESSIONS = [
    {
      path: "/mock/sessions/abc.jsonl",
      title: "Add session switcher to webview",
      firstUserText: "Add a session switcher header to the webview",
      started: new Date(NOW - 3 * 60_000).toISOString(),
      model: "claude-opus-4-5",
      provider: "anthropic",
      messageCount: 14,
      mtime: NOW - 3 * 60_000,
    },
    {
      path: "/mock/sessions/def.jsonl",
      firstUserText: "Explain how the RPC bridge works",
      started: new Date(NOW - 90 * 60_000).toISOString(),
      model: "gpt-5",
      provider: "openai",
      messageCount: 6,
      mtime: NOW - 90 * 60_000,
    },
    {
      path: "/mock/sessions/ghi.jsonl",
      title: "Refactor zotHome",
      firstUserText: "Refactor zotHome.ts into smaller modules",
      started: new Date(NOW - 26 * 3_600_000).toISOString(),
      model: "gemini-2.5-pro",
      provider: "google",
      messageCount: 23,
      mtime: NOW - 26 * 3_600_000,
    },
  ];

  // Keep this list in sync with src/staticCatalog.ts so the browser dev
  // view mirrors what the real VS Code extension shows after probing.
  const MOCK_MODELS = {
    authedProviders: ["anthropic", "openai", "google", "deepseek", "kimi"],
    models: [
      // Anthropic stable
      { Provider: "anthropic", ID: "claude-sonnet-4-5", DisplayName: "Claude Sonnet 4.5", ContextWindow: 200000, MaxOutput: 64000, Reasoning: true },
      { Provider: "anthropic", ID: "claude-opus-4-1", DisplayName: "Claude Opus 4.1", ContextWindow: 200000, MaxOutput: 32000, Reasoning: true },
      { Provider: "anthropic", ID: "claude-opus-4-0", DisplayName: "Claude Opus 4", ContextWindow: 200000, MaxOutput: 32000, Reasoning: true },
      { Provider: "anthropic", ID: "claude-sonnet-4-0", DisplayName: "Claude Sonnet 4", ContextWindow: 200000, MaxOutput: 64000, Reasoning: true },
      { Provider: "anthropic", ID: "claude-haiku-4-5", DisplayName: "Claude Haiku 4.5", ContextWindow: 200000, MaxOutput: 64000, Reasoning: true },
      { Provider: "anthropic", ID: "claude-3-7-sonnet-20250219", DisplayName: "Claude Sonnet 3.7", ContextWindow: 200000, MaxOutput: 64000, Reasoning: true },
      { Provider: "anthropic", ID: "claude-3-5-sonnet-20241022", DisplayName: "Claude Sonnet 3.5 v2", ContextWindow: 200000, MaxOutput: 8192 },
      { Provider: "anthropic", ID: "claude-3-5-haiku-latest", DisplayName: "Claude Haiku 3.5", ContextWindow: 200000, MaxOutput: 8192 },
      { Provider: "anthropic", ID: "claude-3-opus-20240229", DisplayName: "Claude Opus 3", ContextWindow: 200000, MaxOutput: 4096 },
      // Anthropic speculative
      { Provider: "anthropic", ID: "claude-opus-4-5", DisplayName: "Claude Opus 4.5", ContextWindow: 200000, MaxOutput: 64000, Reasoning: true, Speculative: true },
      { Provider: "anthropic", ID: "claude-opus-4-6", DisplayName: "Claude Opus 4.6", ContextWindow: 1000000, MaxOutput: 128000, Reasoning: true, Speculative: true },
      { Provider: "anthropic", ID: "claude-opus-4-7", DisplayName: "Claude Opus 4.7", ContextWindow: 1000000, MaxOutput: 128000, Reasoning: true, Speculative: true },
      { Provider: "anthropic", ID: "claude-sonnet-4-6", DisplayName: "Claude Sonnet 4.6", ContextWindow: 1000000, MaxOutput: 64000, Reasoning: true, Speculative: true },

      // OpenAI stable
      { Provider: "openai", ID: "gpt-5", DisplayName: "GPT-5", ContextWindow: 400000, MaxOutput: 128000, Reasoning: true },
      { Provider: "openai", ID: "gpt-5-mini", DisplayName: "GPT-5 mini", ContextWindow: 400000, MaxOutput: 128000, Reasoning: true },
      { Provider: "openai", ID: "gpt-5-nano", DisplayName: "GPT-5 nano", ContextWindow: 400000, MaxOutput: 128000, Reasoning: true },
      { Provider: "openai", ID: "gpt-4.1", DisplayName: "GPT-4.1", ContextWindow: 1047576, MaxOutput: 32768 },
      { Provider: "openai", ID: "gpt-4.1-mini", DisplayName: "GPT-4.1 mini", ContextWindow: 1047576, MaxOutput: 32768 },
      { Provider: "openai", ID: "gpt-4.1-nano", DisplayName: "GPT-4.1 nano", ContextWindow: 1047576, MaxOutput: 32768 },
      { Provider: "openai", ID: "gpt-4o", DisplayName: "GPT-4o", ContextWindow: 128000, MaxOutput: 16384 },
      { Provider: "openai", ID: "gpt-4o-mini", DisplayName: "GPT-4o mini", ContextWindow: 128000, MaxOutput: 16384 },
      { Provider: "openai", ID: "o4-mini", DisplayName: "o4-mini", ContextWindow: 200000, MaxOutput: 100000, Reasoning: true },
      { Provider: "openai", ID: "o3", DisplayName: "o3", ContextWindow: 200000, MaxOutput: 100000, Reasoning: true },
      { Provider: "openai", ID: "o3-mini", DisplayName: "o3-mini", ContextWindow: 200000, MaxOutput: 100000, Reasoning: true },
      { Provider: "openai", ID: "o1", DisplayName: "o1", ContextWindow: 200000, MaxOutput: 100000, Reasoning: true },
      // OpenAI speculative
      { Provider: "openai", ID: "gpt-5.1", DisplayName: "GPT-5.1", ContextWindow: 272000, MaxOutput: 128000, Reasoning: true, Speculative: true },
      { Provider: "openai", ID: "gpt-5.2", DisplayName: "GPT-5.2", ContextWindow: 272000, MaxOutput: 128000, Reasoning: true, Speculative: true },
      { Provider: "openai", ID: "gpt-5.3", DisplayName: "GPT-5.3", ContextWindow: 272000, MaxOutput: 128000, Reasoning: true, Speculative: true },
      { Provider: "openai", ID: "gpt-5.4", DisplayName: "GPT-5.4", ContextWindow: 272000, MaxOutput: 128000, Reasoning: true, Speculative: true },
      { Provider: "openai", ID: "gpt-5.4-mini", DisplayName: "GPT-5.4 mini", ContextWindow: 272000, MaxOutput: 128000, Reasoning: true, Speculative: true },
      { Provider: "openai", ID: "gpt-5.5", DisplayName: "GPT-5.5", ContextWindow: 400000, MaxOutput: 128000, Reasoning: true, Speculative: true },
      { Provider: "openai", ID: "gpt-5.5-mini", DisplayName: "GPT-5.5 mini", ContextWindow: 400000, MaxOutput: 128000, Reasoning: true, Speculative: true },

      // Google
      { Provider: "google", ID: "gemini-2.5-pro", DisplayName: "Gemini 2.5 Pro", ContextWindow: 1048576, MaxOutput: 65536, Reasoning: true },
      { Provider: "google", ID: "gemini-2.5-flash", DisplayName: "Gemini 2.5 Flash", ContextWindow: 1048576, MaxOutput: 65536, Reasoning: true },
      { Provider: "google", ID: "gemini-2.5-flash-lite", DisplayName: "Gemini 2.5 Flash-Lite", ContextWindow: 1048576, MaxOutput: 65536, Reasoning: true },
      { Provider: "google", ID: "gemini-2.0-flash", DisplayName: "Gemini 2.0 Flash", ContextWindow: 1048576, MaxOutput: 8192 },
      { Provider: "google", ID: "gemini-2.0-flash-lite", DisplayName: "Gemini 2.0 Flash-Lite", ContextWindow: 1048576, MaxOutput: 8192 },

      // DeepSeek
      { Provider: "deepseek", ID: "deepseek-v4-pro", DisplayName: "DeepSeek V4 Pro", ContextWindow: 128000, MaxOutput: 8192, Reasoning: true },
      { Provider: "deepseek", ID: "deepseek-v4-flash", DisplayName: "DeepSeek V4 Flash", ContextWindow: 128000, MaxOutput: 8192 },

      // Kimi (Moonshot)
      { Provider: "kimi", ID: "kimi-for-coding", DisplayName: "Kimi-k2.6", ContextWindow: 262144, MaxOutput: 32000, Reasoning: true },

      // Custom (from models.json)
      { Provider: "ollama", ID: "qwen3.5:4b", DisplayName: "Qwen 3.5 4B (local)", ContextWindow: 32768, Source: "user" },
    ],
    sources: {},
  };

  function handleRpc(cmd: any) {
    if (!cmd || typeof cmd !== "object") return;
    switch (cmd.type) {
      case "prompt":
        runFakeTurn(String(cmd.message ?? ""));
        return;
      case "abort":
        // The streamer checks the aborted flag between deltas.
        aborted = true;
        return;
      case "clear":
        // Nothing to do; the React side has already cleared its state.
        return;
      case "get_state":
        post({
          kind: "frame",
          payload: {
            type: "response",
            command: "get_state",
            success: true,
            data: {
              provider: "anthropic (mock)",
              model: "claude-sonnet-mock",
              busy: false,
            },
          },
        });
        return;
    }
  }

  let aborted = false;

  async function runFakeTurn(prompt: string) {
    aborted = false;
    await sleep(120);
    post({ kind: "frame", payload: { type: "turn_start", step: 1 } });
    post({ kind: "frame", payload: { type: "assistant_start" } });

    // First reply chunk
    const intro =
      `Sure — I'll take a look at "${prompt.slice(0, 60)}".\n\nLet me check a few files first.`;
    for (const chunk of chunks(intro, 4)) {
      if (aborted) return finish("aborted");
      post({ kind: "frame", payload: { type: "text_delta", delta: chunk } });
      await sleep(28);
    }

    // Fake tool call
    const toolId = "tool_" + Math.random().toString(36).slice(2, 8);
    post({
      kind: "frame",
      payload: {
        type: "tool_call",
        id: toolId,
        name: "read",
        args: { path: "src/extension.ts" },
      },
    });
    await sleep(300);
    post({
      kind: "frame",
      payload: {
        type: "tool_result",
        id: toolId,
        is_error: false,
        content: [
          {
            type: "text",
            text: "export function activate() { /* ... */ }\nexport function deactivate() {}\n",
          },
        ],
      },
    });

    // Continuation
    const outro =
      "\n\nFound it. The `activate` function registers the webview view provider and three commands. Want me to refactor the command registration into its own module?";
    for (const chunk of chunks(outro, 5)) {
      if (aborted) return finish("aborted");
      post({ kind: "frame", payload: { type: "text_delta", delta: chunk } });
      await sleep(22);
    }

    post({
      kind: "frame",
      payload: {
        type: "assistant_message",
        content: [{ type: "text", text: intro + outro }],
        time: new Date().toISOString(),
      },
    });
    post({
      kind: "frame",
      payload: {
        type: "usage",
        input: 432,
        output: 188,
        cost_usd: 0.0042,
        cumulative: { input: 432, output: 188, cost_usd: 0.0042 },
      },
    });
    finish("end_turn");
  }

  function finish(stop: string) {
    post({ kind: "frame", payload: { type: "turn_end", stop } });
    post({ kind: "frame", payload: { type: "done" } });
  }

  function chunks(s: string, n: number) {
    const out: string[] = [];
    for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
    return out;
  }

  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Friendly console banner so it's obvious you're in mock mode.
  // eslint-disable-next-line no-console
  console.log(
    "%c[zot-vscode] webview mock active — running outside VS Code",
    "color:#6ADAFF;font-weight:bold",
  );
}

export {};
