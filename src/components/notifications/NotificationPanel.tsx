"use client";

import { useRouter } from "next/navigation";
import type { Execution, ExecutionKind } from "@/types";

export function NotificationPanel({
  items,
  onClose,
  onRead,
}: {
  items: Execution[];
  onClose: () => void;
  onRead: (id: string) => void | Promise<void>;
}) {
  const router = useRouter();

  function handleClick(item: Execution) {
    if (!item.readAt) {
      void onRead(item.id);
    }
    onClose();

    if (item.kind === "dream") {
      router.push("/settings");
      return;
    }
    if (item.conversationId) {
      const url = item.messageId
        ? `/chat/${item.conversationId}?message=${item.messageId}`
        : `/chat/${item.conversationId}`;
      router.push(url);
    }
  }

  return (
    <div className="absolute left-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-lg border border-border-subtle bg-bg-primary shadow-lg">
      <div className="border-b border-border-subtle px-4 py-2">
        <p className="text-xs font-medium text-text-muted">Activity</p>
      </div>
      <ul className="max-h-96 overflow-y-auto">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-text-muted">
            Nothing yet
          </li>
        ) : (
          items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => handleClick(item)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-hover"
              >
                <span className="mt-0.5 shrink-0 text-text-secondary">
                  <KindIcon kind={item.kind} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">
                    {item.summary}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatRelative(item.firedAt)}
                  </p>
                </div>
                {!item.readAt && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function KindIcon({ kind }: { kind: ExecutionKind }) {
  if (kind === "dream") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  if (kind === "reminder_agent") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
