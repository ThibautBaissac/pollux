"use client";

import { useState } from "react";
import Link from "next/link";
import { RecoveryCodesDisplay } from "@/components/RecoveryCodesDisplay";
import { MemoryEditor } from "@/components/settings/MemoryEditor";
import { ModelSelect } from "@/components/settings/ModelSelect";
import { WorkingDirectoryInput } from "@/components/settings/WorkingDirectoryInput";
import { McpServersEditor } from "@/components/settings/McpServersEditor";
import { RemindersManager } from "@/components/settings/RemindersManager";
import { EmailForm } from "@/components/settings/EmailForm";
import { PasswordForm } from "@/components/settings/PasswordForm";
import { RecoveryRegenerateForm } from "@/components/settings/RecoveryRegenerateForm";
import { LogoutAllButton } from "@/components/settings/LogoutAllButton";

type Section =
  | "memory"
  | "model"
  | "working-directory"
  | "mcp-servers"
  | "reminders"
  | "email"
  | "password"
  | "security";

interface SectionDef {
  key: Section;
  label: string;
  description: string;
}

const GROUPS: { label: string; sections: SectionDef[] }[] = [
  {
    label: "AI Config",
    sections: [
      {
        key: "memory",
        label: "Memory",
        description:
          "Facts and preferences Pollux remembers across all conversations.",
      },
      {
        key: "model",
        label: "Model",
        description:
          "Choose which Claude model Pollux uses for conversations.",
      },
      {
        key: "working-directory",
        label: "Working Directory",
        description:
          "The default directory the agent uses for filesystem operations.",
      },
    ],
  },
  {
    label: "Integrations",
    sections: [
      {
        key: "mcp-servers",
        label: "MCP Servers",
        description:
          "Connect external tool servers to extend the agent\u2019s capabilities.",
      },
      {
        key: "reminders",
        label: "Reminders",
        description:
          "Scheduled reminders that deliver messages to conversations when due.",
      },
    ],
  },
  {
    label: "Account",
    sections: [
      {
        key: "email",
        label: "Email",
        description: "Change your login email address.",
      },
      {
        key: "password",
        label: "Password",
        description: "Update your account password.",
      },
      {
        key: "security",
        label: "Security",
        description: "Recovery codes and session management.",
      },
    ],
  },
];

const ALL_SECTIONS = GROUPS.flatMap((g) => g.sections);

export function SettingsPageClient({
  initialEmail,
}: {
  initialEmail: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [activeSection, setActiveSection] = useState<Section>("memory");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showRecoveryForm, setShowRecoveryForm] = useState(false);

  const current = ALL_SECTIONS.find((s) => s.key === activeSection)!;

  function renderContent() {
    switch (activeSection) {
      case "memory":
        return <MemoryEditor />;
      case "model":
        return <ModelSelect />;
      case "working-directory":
        return <WorkingDirectoryInput />;
      case "mcp-servers":
        return <McpServersEditor />;
      case "reminders":
        return <RemindersManager />;
      case "email":
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-secondary">{email}</p>
              <button
                onClick={() => setShowEmailForm((v) => !v)}
                className="text-sm text-accent hover:text-accent-hover"
              >
                {showEmailForm ? "Cancel" : "Change"}
              </button>
            </div>
            {showEmailForm && (
              <EmailForm
                onSuccess={(newEmail) => {
                  setEmail(newEmail);
                  setShowEmailForm(false);
                }}
              />
            )}
          </div>
        );
      case "password":
        return showPasswordForm ? (
          <PasswordForm onSuccess={() => setShowPasswordForm(false)} />
        ) : (
          <button
            onClick={() => setShowPasswordForm(true)}
            className="text-sm text-accent hover:text-accent-hover"
          >
            Change password
          </button>
        );
      case "security":
        return (
          <div className="space-y-4">
            {recoveryCodes ? (
              <RecoveryCodesDisplay
                codes={recoveryCodes}
                onDone={() => setRecoveryCodes(null)}
              />
            ) : showRecoveryForm ? (
              <RecoveryRegenerateForm
                onSuccess={(codes) => {
                  setRecoveryCodes(codes);
                  setShowRecoveryForm(false);
                }}
                onCancel={() => setShowRecoveryForm(false)}
              />
            ) : (
              <button
                onClick={() => setShowRecoveryForm(true)}
                className="w-full rounded-lg border border-border bg-bg-tertiary px-4 py-2 text-sm text-text-primary hover:bg-bg-hover"
              >
                Regenerate recovery codes
              </button>
            )}
            <LogoutAllButton />
          </div>
        );
    }
  }

  return (
    <div className="flex min-h-screen bg-bg-primary">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-bg-secondary">
        <div className="flex items-center justify-between px-4 pt-6 pb-4">
          <h1 className="text-lg font-bold text-text-primary">Settings</h1>
          <Link
            href="/chat"
            className="text-sm text-accent hover:text-accent-hover"
          >
            Back
          </Link>
        </div>

        <nav className="flex-1 space-y-5 px-3 pb-6">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <h2 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                {group.label}
              </h2>
              <ul className="space-y-0.5">
                {group.sections.map((section) => (
                  <li key={section.key}>
                    <button
                      onClick={() => setActiveSection(section.key)}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        activeSection === section.key
                          ? "bg-bg-hover text-accent font-medium"
                          : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                      }`}
                    >
                      {section.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile header + tabs */}
        <div className="md:hidden">
          <div className="flex items-center justify-between border-b border-border bg-bg-secondary px-4 py-3">
            <h1 className="text-lg font-bold text-text-primary">Settings</h1>
            <Link
              href="/chat"
              className="text-sm text-accent hover:text-accent-hover"
            >
              Back
            </Link>
          </div>
          <div className="overflow-x-auto border-b border-border bg-bg-secondary scrollbar-none">
            <div className="flex min-w-max gap-1 px-2 py-1.5">
              {GROUPS.map((group, gi) => (
                <div key={group.label} className="flex items-center gap-1">
                  {gi > 0 && (
                    <div className="mx-1 h-4 w-px shrink-0 bg-border" />
                  )}
                  {group.sections.map((section) => (
                    <button
                      key={section.key}
                      onClick={() => setActiveSection(section.key)}
                      className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        activeSection === section.key
                          ? "bg-bg-hover text-accent"
                          : "text-text-secondary"
                      }`}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Section content */}
        <div className="mx-auto max-w-2xl p-4 md:py-8 md:px-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-text-primary">
              {current.label}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {current.description}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-bg-secondary p-4">
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
}
