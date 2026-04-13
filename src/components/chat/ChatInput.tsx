"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { useChatStream } from "./ChatStreamProvider";
import { AVAILABLE_MODELS } from "@/lib/models";
import {
  parseCommand,
  getCommandSuggestions,
  type SlashCommandDef,
} from "@/lib/slash-commands";

export function ChatInput() {
  const { sendMessage, cancel, status, modelId, dispatchCommand } =
    useChatStream();
  const [text, setText] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = status === "streaming";
  const isBusy = status === "streaming" || status === "loading";
  const modelLabel =
    AVAILABLE_MODELS.find((m) => m.id === modelId)?.label ?? "Sonnet 4.6";

  const suggestions = getCommandSuggestions(text);
  const popoverOpen = !dismissed && suggestions.length > 0;
  const activeIndex = Math.min(selectedIndex, suggestions.length - 1);

  function clearInput() {
    setText("");
    setDismissed(false);
    setSelectedIndex(0);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function acceptSuggestion(cmd: SlashCommandDef) {
    dispatchCommand(cmd.name);
    clearInput();
  }

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const cmd = parseCommand(trimmed);
    if (cmd) {
      dispatchCommand(cmd.name);
    } else if (!isBusy) {
      sendMessage(trimmed);
    } else {
      return;
    }
    clearInput();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (popoverOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (i) => (i - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        acceptSuggestion(suggestions[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        acceptSuggestion(suggestions[activeIndex]);
        return;
      }
    }

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
    <div className="px-4 pb-6 pt-3">
      <div className="mx-auto max-w-2xl">
        {popoverOpen && (
          <div
            role="listbox"
            className="mb-2 overflow-hidden rounded-2xl border border-border-subtle bg-bg-secondary shadow-[0_10px_30px_-14px_rgba(0,0,0,0.7)]"
          >
            {suggestions.map((cmd, i) => (
              <div
                key={cmd.name}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptSuggestion(cmd);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex cursor-pointer items-baseline gap-3 px-4 py-2 text-sm ${
                  i === activeIndex ? "bg-bg-tertiary" : ""
                }`}
              >
                <span className="font-mono text-text-primary">/{cmd.name}</span>
                <span className="text-xs text-text-muted">
                  {cmd.description}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="rounded-2xl border border-border-subtle bg-bg-secondary shadow-[0_10px_30px_-14px_rgba(0,0,0,0.7)] transition-colors focus-within:border-border">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSelectedIndex(0);
              setDismissed(false);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Reply to Pollux…"
            rows={1}
            disabled={status === "loading"}
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
