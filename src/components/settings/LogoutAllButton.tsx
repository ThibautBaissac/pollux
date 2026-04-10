"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutAllButton() {
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
