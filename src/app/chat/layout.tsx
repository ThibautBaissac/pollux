import { ChatStreamProvider } from "@/components/chat/ChatStreamProvider";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ChatStreamProvider>{children}</ChatStreamProvider>;
}
