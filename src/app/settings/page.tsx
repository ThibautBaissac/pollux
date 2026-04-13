import { redirect } from "next/navigation";
import { getEmail, isSetupComplete, validateSession } from "@/lib/auth";
import { SettingsPageClient } from "@/components/settings/SettingsPageClient";
import {
  SECTION_KEYS,
  type Section,
} from "@/components/settings/sections";

function parseSection(raw: string | undefined): Section | undefined {
  if (!raw) return undefined;
  return (SECTION_KEYS as readonly string[]).includes(raw)
    ? (raw as Section)
    : undefined;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  if (!isSetupComplete()) {
    redirect("/setup");
  }

  const authenticated = await validateSession();
  if (!authenticated) {
    redirect("/login");
  }

  const { section } = await searchParams;
  const initialSection = parseSection(section);

  return (
    <SettingsPageClient
      initialEmail={getEmail() ?? ""}
      initialSection={initialSection}
    />
  );
}
