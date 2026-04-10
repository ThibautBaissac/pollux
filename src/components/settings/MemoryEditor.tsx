"use client";

import { useState, useEffect } from "react";

type Tab = "profile" | "knowledge";

export function MemoryEditor() {
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [profileContent, setProfileContent] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/memory?file=profile").then((r) => {
        if (!r.ok) throw new Error("Failed to load profile");
        return r.json();
      }),
      fetch("/api/memory?file=knowledge").then((r) => {
        if (!r.ok) throw new Error("Failed to load knowledge");
        return r.json();
      }),
    ])
      .then(([profileData, knowledgeData]) => {
        setProfileContent(profileData.content);
        setKnowledgeContent(knowledgeData.content);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load memory");
        setLoading(false);
      });
  }, []);

  const content =
    activeTab === "profile" ? profileContent : knowledgeContent;
  const setContent =
    activeTab === "profile" ? setProfileContent : setKnowledgeContent;

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: activeTab, content }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-text-muted">Loading...</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex rounded-lg bg-bg-tertiary p-1">
        <button
          onClick={() => {
            setActiveTab("profile");
            setSaved(false);
          }}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "profile"
              ? "bg-bg-secondary text-text-primary"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          Profile
        </button>
        <button
          onClick={() => {
            setActiveTab("knowledge");
            setSaved(false);
          }}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "knowledge"
              ? "bg-bg-secondary text-text-primary"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          Knowledge Base
        </button>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[200px] w-full resize-y rounded-lg border border-border bg-bg-tertiary px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        placeholder={
          activeTab === "profile"
            ? "Tell Pollux about yourself..."
            : "Add facts and knowledge here..."
        }
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? "Saving..." : saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}
