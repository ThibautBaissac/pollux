import { redirect } from "next/navigation";
import { getEmail, isSetupComplete, validateSession } from "@/lib/auth";
import { SettingsPageClient } from "@/components/settings/SettingsPageClient";

export default async function SettingsPage() {
  if (!isSetupComplete()) {
    redirect("/setup");
  }

  const authenticated = await validateSession();
  if (!authenticated) {
    redirect("/login");
  }

  return <SettingsPageClient initialEmail={getEmail() ?? ""} />;
}
