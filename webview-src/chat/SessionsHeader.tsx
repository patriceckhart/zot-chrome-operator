import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionSummary } from "./types";

interface Props {
  sessions: SessionSummary[];
  activeSessionPath?: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onNewSession: () => void;
}

/**
 * Stateless temporary-session header for the browser operator.
 *
 * The Chrome operator always runs zot with --no-session, so there is no
 * persisted transcript picker here. The single action resets the temporary
 * in-memory conversation and clears the visible transcript.
 */
export function SessionsHeader({ onNewSession }: Props) {
  return (
    <header className="sticky top-0 z-20 flex w-screen max-w-none items-center gap-2 border-b border-border/60 bg-background/80 px-2 py-1.5 backdrop-blur-md">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-secondary/40 px-2 py-1 text-left text-[11px] text-muted-foreground">
        <RotateCcw className="h-3 w-3 shrink-0 text-primary" />
        <span className="truncate text-[12px] text-foreground">
          Temporary browser session
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        title="Reset temporary session"
        onClick={onNewSession}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
    </header>
  );
}
