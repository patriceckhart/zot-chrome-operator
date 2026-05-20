#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")
const DIST = path.join(ROOT, "dist")

if (fs.existsSync(path.join(DIST, "manifest.json"))) {
  console.log("[zot-chrome] Extension already built, skipping.")
  process.exit(0)
}

console.log("[zot-chrome] Building Chrome extension...")

if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
  console.log("[zot-chrome] Installing build dependencies...")
  const install = spawnSync("npm", ["install"], { cwd: ROOT, stdio: "inherit" })
  if (install.status !== 0) process.exit(install.status ?? 1)
}

const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" })
if (build.status !== 0) process.exit(build.status ?? 1)

if (fs.existsSync(path.join(DIST, "manifest.json"))) {
  console.log("[zot-chrome] Extension built successfully.")
  console.log(`[zot-chrome] Load in Chrome: ${DIST}`)
} else {
  console.error("[zot-chrome] ERROR: Build completed but dist/manifest.json not found")
  process.exit(1)
}
