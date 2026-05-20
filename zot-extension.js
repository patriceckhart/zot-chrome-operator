#!/usr/bin/env node

import { createInterface } from "node:readline"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __filename = fileURLToPath(import.meta.url)
const ROOT = dirname(__filename)
const VERSION = "0.1.0"

function send(frame) {
  process.stdout.write(JSON.stringify(frame) + "\n")
}

function log(message) {
  process.stderr.write(`[zot-chrome-operator] ${message}\n`)
}

function installShim() {
  const binDir = join(homedir(), ".local", "bin")
  const shimPath = join(binDir, "zot-chrome")
  const target = resolve(ROOT, "bin", "zot-chrome.js")
  mkdirSync(binDir, { recursive: true })
  writeFileSync(shimPath, `#!/bin/sh\nexec node ${JSON.stringify(target)} "$@"\n`)
  chmodSync(shimPath, 0o755)
  return { shimPath, binDir, target }
}

send({ type: "hello", name: "zot-chrome-operator", version: VERSION, capabilities: [] })

try {
  const { shimPath, binDir } = installShim()
  log(`installed shim: ${shimPath}`)
  if (!(process.env.PATH ?? "").split(":").includes(binDir)) {
    log(`${binDir} is not on PATH; add it to your shell profile to use zot-chrome globally`)
  }
} catch (err) {
  log(`failed to install zot-chrome shim: ${err instanceof Error ? err.message : String(err)}`)
}

send({ type: "ready" })

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on("line", (line) => {
  let frame
  try { frame = JSON.parse(line) } catch { return }
  if (frame.type === "shutdown") {
    send({ type: "shutdown_ack" })
    rl.close()
  }
})
