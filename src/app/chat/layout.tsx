"use client";

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
  const { conversations, refresh, deleteConversation, renameConversation } =
    useConversations();

  const activeId = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length)
    : null;

  async function handleDelete(id: string) {
    await deleteConversation(id);
    if (id === activeId) {
      router.push("/chat");
    }
  }

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
            onDelete={handleDelete}
            onRename={renameConversation}
          />
        </aside>
        <main className="chat-main min-w-0 flex-1">{children}</main>
      </div>
    </ChatStreamProvider>
  );
}
