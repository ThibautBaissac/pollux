"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RecoveryCodesDisplay } from "@/components/RecoveryCodesDisplay";
import { MemoryEditor } from "@/components/settings/MemoryEditor";

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

function EmailForm({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, email: newEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to change email");
        return;
      }
      onSuccess(newEmail);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      <input
        type="email"
        value={newEmail}
        onChange={(e) => setNewEmail(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        placeholder="New email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        placeholder="Current password"
        required
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {loading ? "Updating..." : "Update Email"}
      </button>
    </form>
  );
}

function PasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to change password");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      <input
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        placeholder="Current password"
        required
      />
      <input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        placeholder="New password (at least 8 characters)"
        required
      />
      <input
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        placeholder="Confirm new password"
        required
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {loading ? "Updating..." : "Update Password"}
      </button>
    </form>
  );
}

function RecoveryRegenerateForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (codes: string[]) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/regenerate-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to regenerate codes");
        return;
      }
      onSuccess(data.recoveryCodes);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-text-secondary">
        This will invalidate all existing recovery codes.
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        placeholder="Current password"
        required
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-bg-hover"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {loading ? "Generating..." : "Regenerate"}
        </button>
      </div>
    </form>
  );
}

function LogoutAllButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogoutAll() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout-all", { method: "POST" });
      router.push("/login");
    } catch {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleLogoutAll}
      disabled={loading}
      className="w-full rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {loading ? "Logging out..." : "Log out all sessions"}
    </button>
  );
}
