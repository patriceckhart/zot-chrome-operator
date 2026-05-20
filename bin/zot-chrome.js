#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import http from "node:http"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")

const PID_DIR = path.join(process.env.HOME ?? "/tmp", ".zot-chrome")
const PID_FILE = path.join(PID_DIR, "bridge.pid")
const LOG_FILE = path.join(PID_DIR, "bridge.log")
const PORT = Number(process.env.PORT ?? 9224)
const command = process.argv[2]

function ensureDir() {
  if (!fs.existsSync(PID_DIR)) fs.mkdirSync(PID_DIR, { recursive: true })
}

function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10)
    if (Number.isNaN(pid)) return null
    try { process.kill(pid, 0); return pid }
    catch { fs.unlinkSync(PID_FILE); return null }
  } catch {
    return null
  }
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}`, (res) => {
      let data = ""
      res.on("data", (c) => (data += c))
      res.on("end", () => {
        try { resolve(JSON.parse(data).status === "ok") }
        catch { resolve(false) }
      })
    })
    req.on("error", () => resolve(false))
    req.setTimeout(2000, () => { req.destroy(); resolve(false) })
  })
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function ensureDependencies() {
  if (fs.existsSync(path.join(ROOT, "node_modules", ".bin", "tsx"))) return
  console.log("Installing zot-chrome dependencies...")
  run("npm", ["install", "--ignore-scripts"])
}

function ensureBuilt() {
  if (fs.existsSync(path.join(ROOT, "dist", "manifest.json"))) return
  ensureDependencies()
  console.log("Building Chrome extension...")
  run("npm", ["run", "build", "--", "--emptyOutDir"])
}

function nodeArgsForBridge() {
  return ["--experimental-strip-types", path.join(ROOT, "server", "bridge.ts")]
}

async function start() {
  ensureDir()
  ensureBuilt()
  const existing = readPid()
  if (existing && await checkHealth()) {
    console.log(`Bridge already running (PID ${existing}) on ws://localhost:${PORT}`)
    return
  }
  if (existing) try { process.kill(existing, "SIGTERM") } catch {}

  const logFd = fs.openSync(LOG_FILE, "a")
  const child = spawn(process.execPath, nodeArgsForBridge(), {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  })
  child.unref()
  fs.closeSync(logFd)

  if (!child.pid) {
    console.error("ERROR: Failed to spawn bridge process")
    process.exit(1)
  }
  fs.writeFileSync(PID_FILE, String(child.pid))

  let healthy = false
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500))
    healthy = await checkHealth()
    if (healthy) break
  }
  if (healthy) {
    console.log(`Bridge started (PID ${child.pid})`)
    console.log(`WebSocket: ws://localhost:${PORT}`)
    console.log(`Logs:      ${LOG_FILE}`)
    console.log(`Extension: ${path.join(ROOT, "dist")}`)
  } else {
    console.log(`WARNING: Bridge spawned (PID ${child.pid}) but is not responding yet.`)
    console.log(`Check logs: ${LOG_FILE}`)
  }
}

function stop() {
  const pid = readPid()
  if (!pid) {
    console.log("Bridge is not running")
    return
  }
  try {
    process.kill(pid, "SIGTERM")
    try { fs.unlinkSync(PID_FILE) } catch {}
    console.log(`Bridge stopped (PID ${pid})`)
  } catch (err) {
    console.error(`ERROR: Failed to stop bridge: ${err}`)
    try { fs.unlinkSync(PID_FILE) } catch {}
  }
}

async function status() {
  const pid = readPid()
  const healthy = await checkHealth()
  if (pid && healthy) console.log(`Bridge running (PID ${pid}) on ws://localhost:${PORT}`)
  else if (pid) console.log(`Bridge process exists (PID ${pid}) but is not responding`)
  else console.log("Bridge is not running")
}

function logs() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log("No logs yet. Start the bridge first: zot-chrome start")
    return
  }
  const tail = spawn("tail", ["-f", "-n", "50", LOG_FILE], { stdio: "inherit" })
  process.on("SIGINT", () => { tail.kill(); process.exit(0) })
}

function ext() {
  ensureBuilt()
  console.log(path.join(ROOT, "dist"))
}

function help() {
  console.log(`
zot-chrome — zot Chrome Operator bridge

Usage:
  zot-chrome start    Start the bridge server in the background
  zot-chrome stop     Stop the bridge server
  zot-chrome status   Check if the bridge is running
  zot-chrome logs     Tail bridge logs
  zot-chrome ext      Print Chrome extension path

Environment:
  PORT                Bridge port (default: 9224)
  ZOT_PROVIDER        Optional zot provider
  ZOT_MODEL           Optional zot model
`)
}

switch (command) {
  case "start": await start(); break
  case "stop": stop(); break
  case "status": await status(); break
  case "logs": logs(); break
  case "ext": ext(); break
  default: help(); break
}
