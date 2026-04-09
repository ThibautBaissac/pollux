"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { useChatStream } from "./ChatStreamProvider";

export function ChatInput() {
  const { sendMessage, cancel, status } = useChatStream();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = status === "streaming";

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
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
    <div className="border-t border-border bg-bg-secondary p-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Message Pollux..."
          rows={1}
          disabled={isStreaming}
          className="flex-1 resize-none rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            onClick={cancel}
            className="rounded-lg bg-danger px-4 py-2 font-medium text-white hover:opacity-90"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
