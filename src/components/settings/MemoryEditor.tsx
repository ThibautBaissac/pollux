"use client";

import { useState, useEffect } from "react";
import type { MemoryFile } from "@/lib/memory";

const TABS: { key: MemoryFile; label: string; placeholder: string }[] = [
  { key: "soul", label: "Personality", placeholder: "Define Pollux's personality, tone, and communication style..." },
  { key: "profile", label: "Profile", placeholder: "Tell Pollux about yourself..." },
  { key: "knowledge", label: "Knowledge", placeholder: "Add facts and knowledge here..." },
];

function loadFile(file: MemoryFile) {
  return fetch(`/api/memory?file=${file}`).then((r) => {
    if (!r.ok) throw new Error(`Failed to load ${file}`);
    return r.json();
  });
}

export function MemoryEditor() {
  const [activeTab, setActiveTab] = useState<MemoryFile>("soul");
  const [soulContent, setSoulContent] = useState("");
  const [profileContent, setProfileContent] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([loadFile("soul"), loadFile("profile"), loadFile("knowledge")])
      .then(([soulData, profileData, knowledgeData]) => {
        setSoulContent(soulData.content);
        setProfileContent(profileData.content);
        setKnowledgeContent(knowledgeData.content);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load memory");
        setLoading(false);
      });
  }, []);

  const contentMap = { soul: soulContent, profile: profileContent, knowledge: knowledgeContent };
  const setContentMap = { soul: setSoulContent, profile: setProfileContent, knowledge: setKnowledgeContent };
  const content = contentMap[activeTab];
  const setContent = setContentMap[activeTab];

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

  const activeTabConfig = TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="space-y-3">
      <div className="flex rounded-lg bg-bg-tertiary p-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              setActiveTab(key);
              setSaved(false);
            }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === key
                ? "bg-bg-secondary text-text-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[200px] w-full resize-y rounded-lg border border-border bg-bg-tertiary px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        placeholder={activeTabConfig.placeholder}
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
