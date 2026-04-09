"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { ChatView } from "@/components/chat/ChatView";
import { useChatStream } from "@/components/chat/ChatStreamProvider";

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { loadConversation, conversationId, status } = useChatStream();

  useEffect(() => {
    if (conversationId !== id && status !== "streaming") {
      loadConversation(id);
    }
  }, [id, conversationId, status, loadConversation]);

  return <ChatView />;
}
