"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSidebar } from "./SidebarContext";
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
  const { close: closeSidebar } = useSidebar();
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
        onClick={closeSidebar}
        className={`flex items-center gap-2 rounded-lg my-0.5 px-3 py-1.5 text-sm transition-colors ${
          isActive
            ? "bg-bg-hover text-text-primary"
            : "text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
        }`}
      >
        <span className="truncate flex-1 text-sm">{conversation.title}</span>
      </Link>

      <div className="absolute right-3 top-1/2 -translate-y-1/2" ref={menuRef}>
        <button
          onClick={(e) => {
            e.preventDefault();
            setMenuOpen(!menuOpen);
          }}
          className={`rounded-md p-1 text-text-muted transition-colors hover:text-text-secondary ${
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <circle cx="8" cy="3" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="8" cy="13" r="1.5" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-bg-tertiary py-1 shadow-xl">
            <button
              onClick={handleRename}
              className="w-full px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              Rename
            </button>
            <button
              onClick={handleDelete}
              className="w-full px-3 py-2 text-left text-xs text-danger transition-colors hover:bg-bg-hover"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
