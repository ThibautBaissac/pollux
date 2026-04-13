"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";
import type { Message, ToolUse } from "@/types";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];
const MARKDOWN_COMPONENTS = { pre: CodeBlock };

function truncatePath(path: string, maxLen = 50): string {
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  if (parts.length <= 2) return "..." + path.slice(-maxLen + 3);
  return ".../" + parts.slice(-2).join("/");
}

function formatToolLabel(tool: ToolUse): string {
  const input = tool.input;
  if (!input) return tool.name;

  switch (tool.name) {
    case "Read":
      return input.file_path
        ? `Read ${truncatePath(String(input.file_path))}`
        : tool.name;
    case "Write":
      return input.file_path
        ? `Write ${truncatePath(String(input.file_path))}`
        : tool.name;
    case "Edit":
      return input.file_path
        ? `Edit ${truncatePath(String(input.file_path))}`
        : tool.name;
    case "Glob":
      return input.pattern
        ? `Glob ${String(input.pattern)}`
        : tool.name;
    case "Grep":
      return input.pattern
        ? `Grep "${String(input.pattern)}"`
        : tool.name;
    case "Bash":
      return input.command
        ? `Bash ${String(input.command).slice(0, 60)}`
        : tool.name;
    case "Agent":
      return input.agent_type || input.description
        ? `Agent ${String(input.agent_type || input.description).slice(0, 40)}`
        : tool.name;
    case "WebSearch":
      return input.query
        ? `WebSearch "${String(input.query).slice(0, 40)}"`
        : tool.name;
    case "WebFetch":
      return input.url
        ? `WebFetch ${truncatePath(String(input.url))}`
        : tool.name;
    default:
      return tool.name;
  }
}

export const MessageBubble = memo(function MessageBubble({
  message,
  id,
}: {
  message: Message;
  id?: string;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div id={id} className="flex justify-end">
        <div className="max-w-[80%] rounded-3xl bg-bg-bubble px-5 py-3 text-sm text-text-primary">
          <p className="whitespace-pre-wrap leading-[1.65]">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div id={id} className="w-full">
      {message.content ? (
        <div className="prose prose-invert max-w-none text-sm prose-p:my-2 prose-p:leading-[1.75] prose-li:leading-[1.75] prose-pre:bg-bg-tertiary prose-pre:border prose-pre:border-border-subtle prose-code:text-text-primary prose-code:before:content-none prose-code:after:content-none prose-headings:text-text-primary prose-headings:font-semibold prose-strong:text-text-primary prose-a:text-accent prose-ul:my-2 prose-ol:my-2">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={MARKDOWN_COMPONENTS}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      ) : (
        <span className="inline-block h-4 w-4 animate-pulse rounded-full bg-text-muted" />
      )}
      {message.toolUses && message.toolUses.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {message.toolUses.map((tool, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-tertiary px-2.5 py-1 text-xs text-text-muted"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-text-muted/70" />
              {formatToolLabel(tool)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
