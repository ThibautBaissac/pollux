"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";
import type { Message } from "@/types";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];
const MARKDOWN_COMPONENTS = { pre: CodeBlock };

export const MessageBubble = memo(function MessageBubble({
  message,
}: {
  message: Message;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser ? "bg-accent text-white" : "bg-bg-secondary text-text-primary"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : message.content ? (
          <div className="prose prose-invert max-w-none prose-p:my-1 prose-pre:bg-bg-tertiary prose-pre:border prose-pre:border-border prose-code:text-accent">
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={MARKDOWN_COMPONENTS}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          <span className="inline-block h-5 w-5 animate-pulse rounded-full bg-text-muted" />
        )}
        {message.toolUses && message.toolUses.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.toolUses.map((tool, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded bg-bg-tertiary px-2 py-0.5 text-xs text-text-secondary"
              >
                {tool.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
