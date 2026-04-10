"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useConversations } from "@/hooks/useConversations";
import { ChatStreamProvider } from "@/components/chat/ChatStreamProvider";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SidebarContext } from "@/components/sidebar/SidebarContext";

export function ChatLayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(
    () => setSidebarOpen((prev) => !prev),
    [],
  );

  // Close sidebar on navigation
  useEffect(() => {
    closeSidebar();
  }, [pathname, closeSidebar]);

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
      <SidebarContext.Provider
        value={{ isOpen: sidebarOpen, toggle: toggleSidebar, close: closeSidebar }}
      >
        <div className="flex h-screen">
          {/* Mobile backdrop */}
          <div
            className={`fixed inset-0 z-30 bg-black/50 transition-opacity md:hidden ${
              sidebarOpen
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            onClick={closeSidebar}
          />

          <aside
            className={`sidebar-panel ${sidebarOpen ? "sidebar-open" : ""}`}
          >
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
      </SidebarContext.Provider>
    </ChatStreamProvider>
  );
}
