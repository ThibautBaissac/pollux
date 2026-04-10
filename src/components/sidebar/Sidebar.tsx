"use client";

import Link from "next/link";
import { ConversationItem } from "./ConversationItem";
import type { Conversation } from "@/types";

export function Sidebar({
  conversations,
  activeId,
  loading,
  onDelete,
  onRename,
}: {
  conversations: Conversation[];
  activeId: string | null;
  loading?: boolean;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-3">
        <svg
          width="22"
          height="22"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="shrink-0"
        >
          <defs>
            <linearGradient id="pollux-star" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          <polygon
            points="16,3 18.5,13 29,16 18.5,19 16,29 13.5,19 3,16 13.5,13"
            fill="url(#pollux-star)"
          />
          <circle cx="16" cy="16" r="2.2" fill="#dbeafe" opacity="0.9" />
        </svg>
        <span className="text-base font-semibold text-text-primary">Pollux</span>
      </div>

      {/* New chat button */}
      <div className="px-3 pb-3">
        <Link
          href="/chat"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          New conversation
        </Link>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length > 0 || loading ? (
          <div className="px-3 pb-2">
            <p className="px-2 pb-1.5 text-xs font-medium text-text-muted">
              Recent
            </p>
            {loading
              ? Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="px-2 py-2">
                    <div className="h-3 animate-pulse rounded-full bg-bg-tertiary" />
                  </div>
                ))
              : conversations.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isActive={conv.id === activeId}
                    onDelete={onDelete}
                    onRename={onRename}
                  />
                ))}
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-xs text-text-muted">
            No conversations yet
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border-subtle px-3 py-3">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Settings
        </Link>
      </div>
    </div>
  );
}
