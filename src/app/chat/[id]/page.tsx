"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { ChatView } from "@/components/chat/ChatView";
import { useChatStream } from "@/components/chat/ChatStreamProvider";

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { loadConversation, conversationId, status } = useChatStream();

  useEffect(() => {
    // Only load if we're not already on this conversation.
    // This prevents redundant fetching when router.replace transitions
    // from /chat to /chat/[id] during an active stream.
    if (conversationId !== id && status === "idle") {
      loadConversation(id);
    }
  }, [id, conversationId, status, loadConversation]);

  return <ChatView />;
}
