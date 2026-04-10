"use client";

import { useState } from "react";
import Link from "next/link";
import { RecoveryCodesDisplay } from "@/components/RecoveryCodesDisplay";
import { MemoryEditor } from "@/components/settings/MemoryEditor";
import { ModelSelect } from "@/components/settings/ModelSelect";
import { EmailForm } from "@/components/settings/EmailForm";
import { PasswordForm } from "@/components/settings/PasswordForm";
import { RecoveryRegenerateForm } from "@/components/settings/RecoveryRegenerateForm";
import { LogoutAllButton } from "@/components/settings/LogoutAllButton";

type ActiveSection = "email" | "password" | "recovery" | null;

export function SettingsPageClient({
  initialEmail,
}: {
  initialEmail: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [activeSection, setActiveSection] = useState<ActiveSection>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  function toggleSection(section: ActiveSection) {
    setActiveSection((prev) => (prev === section ? null : section));
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <Link
            href="/chat"
            className="text-sm text-accent hover:text-accent-hover"
          >
            Back to chat
          </Link>
        </div>

        <section className="rounded-lg border border-border bg-bg-secondary p-4">
          <h2 className="text-sm font-medium text-text-primary">Memory</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Facts and preferences Pollux remembers across all conversations.
          </p>
          <div className="mt-3">
            <MemoryEditor />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-bg-secondary p-4">
          <h2 className="text-sm font-medium text-text-primary">Model</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Choose which Claude model Pollux uses for conversations.
          </p>
          <div className="mt-3">
            <ModelSelect />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-bg-secondary p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-text-primary">Email</h2>
              <p className="mt-0.5 text-sm text-text-secondary">{email}</p>
            </div>
            <button
              onClick={() => toggleSection("email")}
              className="text-sm text-accent hover:text-accent-hover"
            >
              Change
            </button>
          </div>
          {activeSection === "email" && (
            <EmailForm
              onSuccess={(newEmail) => {
                setEmail(newEmail);
                setActiveSection(null);
              }}
            />
          )}
        </section>

        <section className="rounded-lg border border-border bg-bg-secondary p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text-primary">Password</h2>
            <button
              onClick={() => toggleSection("password")}
              className="text-sm text-accent hover:text-accent-hover"
            >
              Change
            </button>
          </div>
          {activeSection === "password" && (
            <PasswordForm onSuccess={() => setActiveSection(null)} />
          )}
        </section>

        <section className="rounded-lg border border-border bg-bg-secondary p-4 space-y-4">
          <h2 className="text-sm font-medium text-text-primary">Security</h2>

          {recoveryCodes ? (
            <RecoveryCodesDisplay
              codes={recoveryCodes}
              onDone={() => setRecoveryCodes(null)}
            />
          ) : activeSection === "recovery" ? (
            <RecoveryRegenerateForm
              onSuccess={(codes) => {
                setRecoveryCodes(codes);
                setActiveSection(null);
              }}
              onCancel={() => setActiveSection(null)}
            />
          ) : (
            <button
              onClick={() => toggleSection("recovery")}
              className="w-full rounded-lg border border-border bg-bg-tertiary px-4 py-2 text-sm text-text-primary hover:bg-bg-hover"
            >
              Regenerate recovery codes
            </button>
          )}

          <LogoutAllButton />
        </section>
      </div>
    </div>
  );
}
