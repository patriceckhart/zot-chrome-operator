import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import readline from "node:readline"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")

const PORT = Number(process.env.PORT ?? 9224)
const EXTENSION_PATH = __dirname

let zot: ChildProcess | null = null
let zotRL: readline.Interface | null = null
let activeSocket: WebSocket | null = null
let provider: string | undefined = process.env.ZOT_PROVIDER || undefined
let model: string | undefined = process.env.ZOT_MODEL || undefined

const pendingActions = new Map<string, { resolve: (data: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
let actionCounter = 0

const BROWSER_SYSTEM_PROMPT = `You are a browser operator. You control a real Chrome browser using the browser_action tool.

Use browser_action for requests involving websites, searching, forms, online information, tabs, or the current page. Do not answer from memory when the user asks you to do something in the browser.

Workflow:
1. Use list_tabs to see open tabs when tab choice matters.
2. Use get_tab_context before clicking or typing on a page you have not inspected.
3. Use selectors from page context for click/type/select actions.
4. Verify state-changing actions with get_tab_context.
5. Report what you found or did.

You can navigate, click, type, scroll, extract content, manage tabs, and operate on a specific tabId.`

function startZot() {
  if (zot) return

  const args = ["rpc", "--no-session", "--ext", EXTENSION_PATH, "--append-system-prompt", BROWSER_SYSTEM_PROMPT]
  if (provider) args.push("--provider", provider)
  if (model) args.push("--model", model)

  console.log("[bridge] spawning zot", args.join(" "))
  zot = spawn("zot", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ZOT_CHROME_BRIDGE_PORT: String(PORT) },
    cwd: ROOT,
  })

  zot.stderr?.on("data", (d: Buffer) => process.stderr.write(`[zot stderr] ${d}`))

  zotRL = readline.createInterface({ input: zot.stdout! })
  zotRL.on("line", (line: string) => {
    try {
      const ev = JSON.parse(line)
      if (ev.type === "response" && ev.command === "hello" && ev.data) {
        provider = ev.data.provider ?? provider
        model = ev.data.model ?? model
      }
    } catch {}
    if (activeSocket?.readyState === WebSocket.OPEN) activeSocket.send(line)
  })

  zot.on("exit", (code) => {
    console.log(`[bridge] zot exited with code ${code}`)
    zot = null
    zotRL = null
    if (activeSocket?.readyState === WebSocket.OPEN) {
      activeSocket.send(JSON.stringify({ kind: "status", payload: { state: "exited", code } }))
    }
  })
}

function killZot() {
  if (!zot) return
  zot.kill()
  zot = null
  zotRL = null
}

function sendToZot(cmd: Record<string, unknown>) {
  if (!zot?.stdin?.writable) {
    console.error("[bridge] zot process not ready")
    return
  }
  zot.stdin.write(JSON.stringify(cmd) + "\n")
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

async function handleBrowserAction(req: IncomingMessage, res: ServerResponse) {
  try {
    const action = JSON.parse(await readBody(req))
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      res.writeHead(503, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "Chrome extension not connected" }))
      return
    }

    const requestId = `ba-${++actionCounter}`
    const resultPromise = new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        pendingActions.delete(requestId)
        resolve({ ok: false, error: "Chrome extension did not respond within 30s" })
      }, 30000)
      pendingActions.set(requestId, { resolve, timer })
    })

    activeSocket.send(JSON.stringify({ type: "BROWSER_ACTION_REQUEST", requestId, action }))
    const result = await resultPromise
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(result))
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: String(err) }))
  }
}

function parseModels(text: string) {
  const models: any[] = []
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = line.match(/^(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(✓)?\s*\s+(\S+)\s+(.+)$/)
    if (!m) continue
    models.push({
      Provider: m[1],
      ID: m[2],
      Context: Number(m[3]),
      MaxOutput: Number(m[4]),
      Reasoning: Boolean(m[5]),
      Source: m[6],
      DisplayName: m[7].trim(),
    })
  }
  return { authedProviders: Array.from(new Set(models.map((m) => m.Provider))), models, updatedAt: new Date().toISOString() }
}

function listModels(): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn("zot", ["--list-models"], { cwd: ROOT, env: process.env })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.on("close", () => resolve(parseModels(out)))
    child.on("error", () => resolve({ authedProviders: [], models: [], updatedAt: new Date().toISOString() }))
  })
}

const httpServer = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return void (res.writeHead(204), res.end())
  if (req.method === "POST" && req.url === "/browser-action") return void handleBrowserAction(req, res)
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ status: "ok", zot: zot ? "running" : "stopped", chrome: activeSocket?.readyState === WebSocket.OPEN ? "connected" : "disconnected" }))
})

const wss = new WebSocketServer({ server: httpServer })
wss.on("connection", (ws) => {
  console.log("[bridge] extension connected")
  activeSocket = ws
  startZot()

  ws.on("message", (raw) => {
    void (async () => {
      try {
        const msg = JSON.parse(raw.toString())

        if (msg.type === "BROWSER_ACTION_RESULT") {
          const pending = pendingActions.get(msg.requestId)
          if (pending) {
            clearTimeout(pending.timer)
            pendingActions.delete(msg.requestId)
            pending.resolve(msg.result)
          }
          return
        }

        if (msg.kind === "ready") {
          sendToZot({ type: "get_state" })
          ws.send(JSON.stringify({ kind: "sessions", payload: { sessions: [] } }))
          ws.send(JSON.stringify({ kind: "models", payload: await listModels() }))
          return
        }
        if (msg.kind === "rpc") return sendToZot(msg.payload ?? {})
        if (msg.kind === "restart") {
          killZot(); startZot()
          ws.send(JSON.stringify({ kind: "status", payload: { state: "restarted" } }))
          return
        }
        if (msg.kind === "new_session") {
          sendToZot({ type: "clear" })
          ws.send(JSON.stringify({ kind: "status", payload: { state: "new-session" } }))
          return
        }
        if (msg.kind === "list_models") {
          ws.send(JSON.stringify({ kind: "models", payload: await listModels() }))
          return
        }
        if (msg.kind === "list_sessions") {
          ws.send(JSON.stringify({ kind: "sessions", payload: { sessions: [] } }))
          return
        }
        if (msg.kind === "select_model") {
          provider = msg.payload?.provider
          model = msg.payload?.model
          killZot(); startZot()
          ws.send(JSON.stringify({ kind: "status", payload: { state: "restarted", reason: "provider-switch", provider, model } }))
          return
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: String(err) }))
      }
    })()
  })

  ws.on("close", () => {
    console.log("[bridge] extension disconnected")
    activeSocket = null
    for (const [id, pending] of pendingActions) {
      clearTimeout(pending.timer)
      pending.resolve({ ok: false, error: "Chrome extension disconnected" })
      pendingActions.delete(id)
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`[bridge] zot Chrome bridge listening on ws://localhost:${PORT}`)
  console.log(`[bridge] Load the Chrome extension from ${path.join(ROOT, "dist")}`)
})

process.on("SIGINT", () => { killZot(); process.exit(0) })
process.on("SIGTERM", () => { killZot(); process.exit(0) })
