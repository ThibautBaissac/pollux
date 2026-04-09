import { redirect } from "next/navigation";
import { isSetupComplete, validateSession } from "@/lib/auth";
import { ChatLayoutShell } from "@/components/chat/ChatLayoutShell";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSetupComplete()) {
    redirect("/setup");
  }

  const authenticated = await validateSession();
  if (!authenticated) {
    redirect("/login");
  }

  return <ChatLayoutShell>{children}</ChatLayoutShell>;
}
