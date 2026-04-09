"use client";

import { useEffect } from "react";
import { ChatView } from "@/components/chat/ChatView";
import { useChatStream } from "@/components/chat/ChatStreamProvider";

export default function NewChatPage() {
  const { reset } = useChatStream();

  useEffect(() => {
    reset();
  }, [reset]);

  return <ChatView />;
}
