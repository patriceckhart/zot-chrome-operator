#!/usr/bin/env node

import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __filename = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(__filename), "..")

export function installZotChromeShim() {
  const binDir = join(homedir(), ".local", "bin")
  const shimPath = join(binDir, "zot-chrome")
  const target = resolve(ROOT, "bin", "zot-chrome.js")
  mkdirSync(binDir, { recursive: true })
  writeFileSync(shimPath, `#!/bin/sh\nexec node ${JSON.stringify(target)} "$@"\n`)
  chmodSync(shimPath, 0o755)
  return { shimPath, binDir, target }
}

if (process.argv[1] === __filename) {
  const { shimPath, binDir } = installZotChromeShim()
  console.log(`installed ${shimPath}`)
  if (!(process.env.PATH ?? "").split(":").includes(binDir)) {
    console.log(`add ${binDir} to PATH to use zot-chrome globally`)
  }
}
