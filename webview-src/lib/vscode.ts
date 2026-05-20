interface HostApi {
  postMessage(msg: unknown): void
  getState<T = unknown>(): T | undefined
  setState<T>(state: T): void
}

type PendingBrowserAction = {
  requestId: string
  action: Record<string, unknown>
}

let api: HostApi | undefined
let socket: WebSocket | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let pendingQueue: unknown[] = []

const BRIDGE_URL = "ws://localhost:9224"

function dispatchToWindow(msg: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data: msg }))
}

async function executeBrowserAction(action: Record<string, unknown>): Promise<Record<string, unknown>> {
  const type = action.type as string
  const send = (message: Record<string, unknown>) => new Promise<Record<string, unknown>>((resolve) => {
    chrome.runtime.sendMessage(message, (res) => resolve(res ?? { ok: false, error: "No response" }))
  })

  if (type === "list_tabs") {
    const res = await send({ type: "LIST_TABS" })
    return res.ok && res.tabs ? { ok: true, result: { tabs: res.tabs } } : res
  }
  if (type === "new_tab") return send({ type: "NEW_TAB", url: action.url })
  if (type === "close_tab") return send({ type: "CLOSE_TAB", tabId: action.tabId })
  if (type === "switch_tab") return send({ type: "SWITCH_TAB", tabId: action.tabId })
  if (type === "get_tab_context") {
    const res = await send({ type: "GET_PAGE_CONTEXT", tabId: action.tabId })
    return res.ok && res.context ? { ok: true, context: res.context } : res
  }
  return send({ type: "EXECUTE_ACTION", action })
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  socket = new WebSocket(BRIDGE_URL)
  socket.onopen = () => {
    for (const msg of pendingQueue.splice(0)) socket?.send(JSON.stringify(msg))
    dispatchToWindow({ kind: "bridge", payload: { connected: true } })
  }
  socket.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg.type === "BROWSER_ACTION_REQUEST") {
        const req = msg as PendingBrowserAction
        void executeBrowserAction(req.action).then((result) => {
          socket?.send(JSON.stringify({ type: "BROWSER_ACTION_RESULT", requestId: req.requestId, result }))
        })
        return
      }
      if (msg.kind) dispatchToWindow(msg)
      else dispatchToWindow({ kind: "frame", payload: msg })
    } catch {}
  }
  socket.onclose = () => {
    dispatchToWindow({ kind: "bridge", payload: { connected: false } })
    socket = undefined
    reconnectTimer = setTimeout(connect, 1500)
  }
  socket.onerror = () => socket?.close()
}

export function vscode(): HostApi {
  if (!api) {
    connect()
    api = {
      postMessage(msg: unknown) {
        connect()
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
        else pendingQueue.push(msg)
      },
      getState: () => undefined,
      setState: () => {},
    }
  }
  return api
}

window.addEventListener("beforeunload", () => {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  socket?.close()
})
