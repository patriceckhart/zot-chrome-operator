#!/usr/bin/env node
import { createInterface } from "node:readline"
import { stdin, stdout, stderr, env } from "node:process"
import http from "node:http"

const BRIDGE_PORT = Number(env.ZOT_CHROME_BRIDGE_PORT ?? env.PORT ?? 9224)

function send(frame) {
  stdout.write(JSON.stringify(frame) + "\n")
}

function log(message) {
  stderr.write(`[zot-chrome extension] ${message}\n`)
}

function postAction(action) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(action)
    const req = http.request({
      hostname: "localhost",
      port: BRIDGE_PORT,
      path: "/browser-action",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => {
        try { resolve(JSON.parse(data)) }
        catch { reject(new Error(`Bridge returned invalid JSON: ${data.slice(0, 200)}`)) }
      })
    })
    req.on("error", (err) => reject(new Error(`Bridge not reachable at localhost:${BRIDGE_PORT}: ${err.message}`)))
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("Bridge request timed out")) })
    req.write(body)
    req.end()
  })
}

function formatPageContext(ctx) {
  let out = ""
  if (ctx.url) out += `URL: ${ctx.url}\n`
  if (ctx.title) out += `Title: ${ctx.title}\n`
  if (ctx.inputs?.length) {
    out += "\nForm inputs:\n"
    for (const i of ctx.inputs) {
      out += `  - ${i.selector} (${i.type}) name="${i.name ?? ""}" placeholder="${i.placeholder ?? ""}"`
      if (i.value) out += ` value="${String(i.value).slice(0, 100)}"`
      out += "\n"
    }
  }
  if (ctx.buttons?.length) {
    out += "\nButtons:\n"
    for (const b of ctx.buttons) out += `  - ${b.selector}: "${b.text}"\n`
  }
  if (ctx.links?.length) {
    out += "\nLinks (first 20):\n"
    for (const l of ctx.links.slice(0, 20)) out += `  - "${l.text}" -> ${l.href}\n`
  }
  if (ctx.text) out += `\nPage text (excerpt):\n${String(ctx.text).slice(0, 4000)}\n`
  return out
}

function formatTabs(tabs) {
  return "Open tabs:\n" + tabs.map((t) => `  - [${t.tabId}] ${t.active ? "(active) " : ""}${t.title || "(no title)"} — ${t.url}`).join("\n")
}

send({ type: "hello", name: "zot-browser-tool", version: "0.1.0", capabilities: ["tools"] })
send({
  type: "register_tool",
  name: "browser_action",
  description: "Control Chrome: navigate pages, click elements, type text, manage tabs, and extract page content.",
  schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["navigate", "click", "type", "select", "scroll", "extract", "get_tab_context", "list_tabs", "new_tab", "close_tab", "switch_tab", "wait"] },
      url: { type: "string" },
      selector: { type: "string" },
      text: { type: "string" },
      value: { type: "string" },
      submit: { type: "boolean" },
      direction: { type: "string", enum: ["up", "down"] },
      amount: { type: "number" },
      tabId: { type: "number" },
      ms: { type: "number" }
    },
    required: ["action"]
  }
})
send({ type: "ready" })

const rl = createInterface({ input: stdin, crlfDelay: Infinity })
rl.on("line", async (line) => {
  let frame
  try { frame = JSON.parse(line) } catch { return }

  if (frame.type === "shutdown") {
    send({ type: "shutdown_ack" })
    rl.close()
    return
  }

  if (frame.type !== "tool_call" || frame.name !== "browser_action") return

  try {
    const args = frame.args ?? {}
    const payload = { type: args.action }
    for (const key of ["tabId", "url", "selector", "text", "value", "submit", "direction", "amount", "ms"]) {
      if (args[key] != null) payload[key] = args[key]
    }
    const res = await postAction(payload)
    if (!res.ok) throw new Error(res.error ?? "Action failed")

    let text = "Action completed successfully."
    if (args.action === "list_tabs" && res.result?.tabs) text = formatTabs(res.result.tabs)
    else if (args.action === "get_tab_context" && res.context) text = formatPageContext(res.context)
    else if (res.result) text = `Success: ${JSON.stringify(res.result)}`

    send({ type: "tool_result", id: frame.id, content: [{ type: "text", text }] })
  } catch (err) {
    send({ type: "tool_result", id: frame.id, is_error: true, content: [{ type: "text", text: `browser_action failed: ${err instanceof Error ? err.message : String(err)}` }] })
  }
})

log("ready")
