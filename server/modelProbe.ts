import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { randomBytes } from "node:crypto";
import type { CatalogModel } from "./zotHome";

/**
 * GUI-launched VS Code on macOS inherits `launchd`'s minimal PATH, which
 * typically excludes `~/.local/bin`, `~/go/bin`, `/opt/homebrew/bin`, and
 * other places `zot` commonly lives. If the user configured a relative
 * `zot.executable` (the default), resolve it against PATH **plus** these
 * fallback directories so the spawn doesn't fail silently.
 */
export function resolveZotExecutable(name: string): string {
  // Absolute path or path with separator: trust the user.
  if (path.isAbsolute(name) || name.includes(path.sep)) return name;

  const envPath = process.env.PATH ?? "";
  const extra = [
    path.join(os.homedir(), ".local", "bin"),
    path.join(os.homedir(), "bin"),
    path.join(os.homedir(), "go", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const dirs = [...envPath.split(path.delimiter), ...extra].filter(Boolean);
  for (const d of dirs) {
    const candidate = path.join(d, name);
    try {
      const st = fs.statSync(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      // not here, try next
    }
  }
  return name; // fall back to original; caller will see ENOENT
}

/**
 * Probe `zot rpc` once per provider and collect `get_models` responses.
 *
 * Background: `models-cache.json` only stores models that zot has fetched
 * live from a provider's catalog endpoint (so far, just Google's discovery
 * API). The bulk of providers (Anthropic, OpenAI, Kimi, DeepSeek, …) live
 * as a static list compiled into the binary. The cleanest way to learn
 * about every model the *installed* zot knows about, including custom ones
 * merged from `models.json`, is to ask zot itself.
 *
 * We do that by spinning up a short-lived `zot rpc --provider <p>` per
 * authed provider, sending `get_models`, parsing the reply, and tearing
 * the process back down. All probes run in parallel.
 *
 * The result is unioned with whatever was already in `models-cache.json`
 * so we degrade gracefully if a probe fails (e.g. provider needs an API
 * key that isn't set; zot will refuse to start and we just skip it).
 */
export interface ProbeOptions {
  executable: string;
  cwd: string;
  /** Hard cap so a misbehaving zot can't hang the chat view forever. */
  timeoutMs?: number;
}

export async function probeProviderModels(
  provider: string,
  opts: ProbeOptions,
): Promise<CatalogModel[]> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const exe = resolveZotExecutable(opts.executable);
  return new Promise<CatalogModel[]>((resolve) => {
    const proc = spawn(
      exe,
      ["rpc", "--provider", provider, "--cwd", opts.cwd, "--no-tools"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    proc.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });

    let settled = false;
    const settle = (models: CatalogModel[]) => {
      if (settled) return;
      settled = true;
      try {
        proc.stdin.end();
      } catch {
        // ignore
      }
      proc.kill("SIGTERM");
      resolve(models);
    };

    const timer = setTimeout(() => settle([]), timeoutMs);

    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let frame: any;
      try {
        frame = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (
        frame?.type === "response" &&
        frame.command === "get_models" &&
        frame.success &&
        Array.isArray(frame.data?.models)
      ) {
        clearTimeout(timer);
        const out: CatalogModel[] = frame.data.models.map((m: any) => ({
          Provider: m.provider ?? provider,
          ID: m.id,
          DisplayName: m.display_name || m.id,
          ContextWindow: m.context_window,
          MaxOutput: m.max_output,
          Reasoning: Boolean(m.reasoning),
          Source: "probe",
        }));
        settle(out);
      }
    });

    proc.on("error", (err) => {
      // Surface to the host console so a missing binary is debuggable.
      console.error(
        `[zot-vscode] model probe spawn failed for ${provider} (${exe}):`,
        err,
      );
      settle([]);
    });
    proc.on("exit", (code) => {
      if (!settled && code !== 0 && stderr) {
        console.warn(
          `[zot-vscode] model probe ${provider} exited code=${code}: ${stderr.trim().slice(0, 200)}`,
        );
      }
      settle([]);
    });

    // Some zot builds require a hello when ZOTCORE_RPC_TOKEN is set; we
    // never set one here so we can skip straight to get_models.
    const id = randomBytes(4).toString("hex");
    proc.stdin.write(
      JSON.stringify({ id, type: "get_models" }) + "\n",
    );
  });
}

/** Run probes for many providers in parallel and merge their results. */
export async function probeAllProviders(
  providers: string[],
  opts: ProbeOptions,
): Promise<CatalogModel[]> {
  const results = await Promise.all(
    providers.map((p) => probeProviderModels(p, opts)),
  );
  const merged: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const list of results) {
    for (const m of list) {
      const key = `${m.Provider}::${m.ID}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(m);
    }
  }
  return merged;
}
