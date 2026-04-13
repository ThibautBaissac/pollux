"use client";

import { useCallback, useEffect, useState } from "react";
import type { Execution } from "@/types";

const POLL_MS = 30_000;

function sameFeed(a: Execution[], b: Execution[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].readAt !== b[i].readAt) return false;
  }
  return true;
}

export function useNotifications() {
  const [items, setItems] = useState<Execution[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = (await res.json()) as {
        items: Execution[];
        unreadCount: number;
      };
      setItems((prev) => (sameFeed(prev, data.items) ? prev : data.items));
      setUnreadCount(data.unreadCount);
    } catch {
      // ignore network errors; next tick will retry
    }
  }, []);

  useEffect(() => {
    function tick() {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }
    tick();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const markRead = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/notifications/${id}/read`, {
          method: "POST",
        });
        if (!res.ok) return;
      } catch {
        return;
      }
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((e) => (e.id === id && !e.readAt ? { ...e, readAt: now } : e)),
      );
      refresh();
    },
    [refresh],
  );

  return { items, unreadCount, markRead, refresh };
}
