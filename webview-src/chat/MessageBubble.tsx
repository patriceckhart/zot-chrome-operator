import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Wrench,
  User,
} from "lucide-react";
import { AnimatedZ } from "@/components/AnimatedZ";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "./types";

interface Props {
  message: ChatMessage;
  /** When true, the assistant bubble shows a blinking caret at the tail. */
  streaming?: boolean;
}

export function MessageBubble({ message, streaming }: Props) {
  switch (message.role) {
    case "user":
      return <UserBubble message={message} />;
    case "assistant":
      return <AssistantBubble message={message} streaming={streaming} />;
    case "tool":
      return <ToolBubble message={message} />;
    case "system":
      return <SystemBubble message={message} />;
  }
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[88%] items-end gap-2">
        <div className="zot-user-bubble rounded-2xl rounded-br-sm px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
          {message.text}
        </div>
        <div className="mt-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
          <User className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  const isError = message.isError;
  if (!isError && !message.text.trim()) return null;
  return (
    <div className="flex w-full justify-start">
      <div className="flex max-w-[92%] items-start gap-2">
        <div
          className={cn(
            // Black background "chip" with the same outer footprint as the
            // user avatar (h-6 w-6). The animated z mark is rendered at the
            // same visual size as the User lucide icon over there (h-3.5)
            // so both avatars feel balanced.
            "mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black ring-1 ring-border/60",
            isError && "bg-destructive/20 ring-destructive/40 text-destructive",
          )}
        >
          {isError ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <AnimatedZ size={11} />
          )}
        </div>
        <div
          className={cn(
            "zot-card-glow rounded-2xl rounded-tl-sm border border-border/60 bg-card px-3.5 py-2 text-[13px] leading-relaxed text-foreground whitespace-pre-wrap break-words",
            isError && "border-destructive/50 text-destructive",
          )}
        >
          {message.text}
          {streaming && message.pending && <span className="zot-caret" />}
          {message.pending && !message.text && (
            <span className="zot-pulse inline-flex items-center align-middle">
              <span />
              <span />
              <span />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolBubble({ message }: { message: ChatMessage }) {
  const [open, setOpen] = React.useState(false);
  const hasBody = message.text.trim().length > 0;
  if (!hasBody) return null;
  return (
    <div className="flex w-full justify-start">
      <div className="zot-tool-card w-full max-w-[92%] overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {hasBody ? (
            open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )
          ) : (
            <span className="inline-block h-3 w-3" />
          )}
          <Wrench className="h-3 w-3 text-primary" />
          <span className="font-mono text-[11px] uppercase tracking-wider">
            {message.tool ?? "tool"}
          </span>
          {message.pending ? (
            <span className="zot-pulse inline-flex items-center">
              <span />
              <span />
              <span />
            </span>
          ) : message.isError ? (
            <span className="ml-auto text-[11px] text-destructive">error</span>
          ) : (
            <span className="ml-auto text-[11px] text-primary/80">done</span>
          )}
        </button>
        {open && hasBody && (
          <pre className="max-h-72 overflow-auto border-t border-border/40 bg-background/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
            {message.text}
          </pre>
        )}
      </div>
    </div>
  );
}

function SystemBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex w-full justify-center">
      <div
        className={cn(
          "rounded-full border border-border/50 bg-secondary/60 px-3 py-1 text-[11px] text-muted-foreground",
          message.isError && "border-destructive/40 text-destructive",
        )}
      >
        {message.text}
      </div>
    </div>
  );
}
