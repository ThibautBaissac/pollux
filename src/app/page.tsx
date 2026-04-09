import { redirect } from "next/navigation";
import { validateSession, isSetupComplete } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isSetupComplete()) {
    redirect("/setup");
  }

  const authenticated = await validateSession();
  if (!authenticated) {
    redirect("/login");
  }

  redirect("/chat");
}
