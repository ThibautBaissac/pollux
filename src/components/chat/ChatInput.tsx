"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { useChatStream } from "./ChatStreamProvider";
import { AVAILABLE_MODELS } from "@/lib/models";

export function ChatInput() {
  const { sendMessage, cancel, status } = useChatStream();
  const [text, setText] = useState("");
  const [modelLabel, setModelLabel] = useState("Sonnet 4.6");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = status === "streaming";
  const isBusy = status === "streaming" || status === "loading";

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/settings/model", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const label = AVAILABLE_MODELS.find((m) => m.id === data?.model)?.label;
        if (label) setModelLabel(label);
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    sendMessage(trimmed);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }

  return (
    <div className="px-4 pb-5 pt-3">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-border bg-bg-secondary transition-colors">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Reply to Pollux…"
            rows={1}
            disabled={isBusy}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            {/* Model indicator */}
            <span className="flex items-center gap-1 text-xs text-text-muted select-none">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
              {modelLabel}
            </span>

            {/* Send / Stop button */}
            {isStreaming ? (
              <button
                onClick={cancel}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-text-primary text-bg-primary transition-opacity hover:opacity-75"
                title="Stop generating"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!text.trim() || isBusy}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-text-primary text-bg-primary transition-opacity hover:opacity-75 disabled:opacity-20"
                title="Send message"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
