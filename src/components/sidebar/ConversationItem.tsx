"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import type { Conversation } from "@/types";

export function ConversationItem({
  conversation,
  isActive,
  onDelete,
  onRename,
}: {
  conversation: Conversation;
  isActive: boolean;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  function handleRename() {
    setMenuOpen(false);
    const newTitle = window.prompt("Rename conversation", conversation.title);
    if (newTitle && newTitle.trim()) {
      onRename(conversation.id, newTitle.trim());
    }
  }

  function handleDelete() {
    setMenuOpen(false);
    onDelete(conversation.id);
  }

  return (
    <div className="group relative">
      <Link
        href={`/chat/${conversation.id}`}
        className={`flex items-center gap-2 px-3 py-2.5 text-sm ${
          isActive
            ? "bg-bg-tertiary text-text-primary"
            : "text-text-secondary hover:bg-bg-hover"
        }`}
      >
        <span className="truncate flex-1">{conversation.title}</span>
      </Link>

      <div className="absolute right-2 top-1/2 -translate-y-1/2" ref={menuRef}>
        <button
          onClick={(e) => {
            e.preventDefault();
            setMenuOpen(!menuOpen);
          }}
          className={`rounded p-1 text-text-muted hover:text-text-secondary hover:bg-bg-tertiary ${
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <circle cx="8" cy="3" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="8" cy="13" r="1.5" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border border-border bg-bg-secondary py-1 shadow-lg">
            <button
              onClick={handleRename}
              className="w-full px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-bg-hover"
            >
              Rename
            </button>
            <button
              onClick={handleDelete}
              className="w-full px-3 py-1.5 text-left text-sm text-danger hover:bg-bg-hover"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
