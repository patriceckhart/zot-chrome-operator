import * as React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ChevronDown, Check, Cpu, Search, Sparkle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogModel } from "./types";

interface Props {
  models: CatalogModel[];
  currentProvider?: string;
  currentModel?: string;
  loading?: boolean;
  onSelect: (provider: string, model: string) => void;
}

/**
 * Compact model picker used in the chat header. Groups models by provider,
 * highlights the active one, supports type-to-filter. The list comes pre-
 * filtered to authed providers by the extension host.
 */
export function ModelPicker({
  models,
  currentProvider,
  currentModel,
  loading,
  onSelect,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => {
      const hay = `${m.Provider} ${m.ID} ${m.DisplayName ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [models, query]);

  const grouped = React.useMemo(() => {
    const byProvider = new Map<string, CatalogModel[]>();
    for (const m of filtered) {
      const arr = byProvider.get(m.Provider) ?? [];
      arr.push(m);
      byProvider.set(m.Provider, arr);
    }
    // Stable provider order: current first, then alphabetical.
    const providers = Array.from(byProvider.keys()).sort((a, b) => {
      if (a === currentProvider) return -1;
      if (b === currentProvider) return 1;
      return a.localeCompare(b);
    });
    return providers.map((p) => ({
      provider: p,
      models: (byProvider.get(p) ?? []).sort((a, b) =>
        (a.DisplayName || a.ID).localeCompare(b.DisplayName || b.ID),
      ),
    }));
  }, [filtered, currentProvider]);

  const label = currentModel || (loading ? "loading…" : "select model");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex max-w-[220px] items-center gap-1.5 rounded-md border border-border/60 bg-secondary/40 px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-secondary/80 hover:text-foreground"
          title="Switch model"
        >
          <Cpu className="h-3 w-3 shrink-0 text-primary" />
          <span className="truncate font-mono text-[11px] text-foreground">
            {label}
          </span>
          {currentProvider && (
            <span className="shrink-0 truncate font-mono text-[10px] opacity-60">
              · {currentProvider}
            </span>
          )}
          {/* Picker opens upward, so the indicator points up when closed.
              Rotates 180° (pointing down) while open to match the convention. */}
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 rotate-180 opacity-60 transition-transform group-data-[state=open]:rotate-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="flex w-[320px] max-h-[60vh] flex-col p-0"
        align="start"
        side="top"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter models…"
            className="h-7 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:ring-0"
            autoFocus
          />
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {filtered.length}
          </span>
        </div>
        {/*
          Native vertical scroller. Radix's ScrollArea Viewport (`display:
          table; h-full w-full`) doesn't size cleanly inside this flex
          column — the inner content stays full-height and the scrollbar
          never appears. A plain `overflow-y-auto` div respects the
          `flex-1 min-h-0` constraint and scrolls reliably.
        */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <div className="px-1 py-1">
            {grouped.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {loading ? "Loading…" : "No models available."}
                <div className="mt-1 text-[10px] opacity-70">
                  Log in to a provider via{" "}
                  <code className="font-mono text-primary">zot auth</code> or
                  add custom ones in{" "}
                  <code className="font-mono text-primary">models.json</code>.
                </div>
              </div>
            )}
            {grouped.map((g) => (
              <ProviderGroup
                key={g.provider}
                provider={g.provider}
                models={g.models}
                currentProvider={currentProvider}
                currentModel={currentModel}
                onSelect={(p, m) => {
                  onSelect(p, m);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProviderGroup({
  provider,
  models,
  currentProvider,
  currentModel,
  onSelect,
}: {
  provider: string;
  models: CatalogModel[];
  currentProvider?: string;
  currentModel?: string;
  onSelect: (provider: string, model: string) => void;
}) {
  return (
    <div className="mb-1 last:mb-0">
      <div
        data-sticky-header
        className="sticky top-0 z-10 flex items-center gap-1.5 px-2 pb-1 pt-2"
      >
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {provider}
        </span>
        <span className="h-px flex-1 bg-border/60" />
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {models.length}
        </span>
      </div>
      <ul>
        {models.map((m) => {
          const active =
            provider === currentProvider && m.ID === currentModel;
          return (
            <li key={`${provider}::${m.ID}`}>
              <button
                type="button"
                onClick={() => onSelect(provider, m.ID)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                  active
                    ? "bg-primary/15 text-foreground"
                    : "hover:bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm",
                    active ? "text-primary" : "text-transparent",
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
                <span className="flex-1 truncate font-mono text-[12px]">
                  {m.DisplayName || m.ID}
                </span>
                {m.Reasoning && (
                  <span
                    title="reasoning model"
                    className="shrink-0 text-primary opacity-70"
                  >
                    <Sparkle className="h-3 w-3" />
                  </span>
                )}
                {m.Speculative && (
                  <span
                    title="speculative / future model"
                    className="shrink-0 rounded border border-amber-500/50 bg-amber-500/10 px-1 text-[9px] uppercase tracking-wider text-amber-400"
                  >
                    spec
                  </span>
                )}
                {m.Source === "user" && (
                  <span
                    title="from models.json"
                    className="shrink-0 rounded border border-primary/40 px-1 text-[9px] uppercase text-primary"
                  >
                    custom
                  </span>
                )}
                {m.ContextWindow ? (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {fmtTokens(m.ContextWindow)}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return String(n);
}
