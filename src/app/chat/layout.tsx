"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useConversations } from "@/hooks/useConversations";
import { ChatStreamProvider } from "@/components/chat/ChatStreamProvider";
import { Sidebar } from "@/components/sidebar/Sidebar";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    conversations,
    loading,
    refresh,
    deleteConversation,
    renameConversation,
  } = useConversations();

  const activeId = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length)
    : null;

  async function handleDelete(id: string) {
    await deleteConversation(id);
    if (id === activeId) {
      router.push("/chat");
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "N") {
        e.preventDefault();
        router.push("/chat");
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return (
    <ChatStreamProvider onConversationCreated={refresh}>
      <div
        className="flex h-screen"
        data-has-conversation={activeId ? "true" : "false"}
      >
        <aside className="sidebar-panel">
          <Sidebar
            conversations={conversations}
            activeId={activeId}
            loading={loading}
            onDelete={handleDelete}
            onRename={renameConversation}
          />
        </aside>
        <main className="chat-main min-w-0 flex-1">{children}</main>
      </div>
    </ChatStreamProvider>
  );
}
