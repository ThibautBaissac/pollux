"use client";

import { useState, useEffect } from "react";
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@/lib/models";

export function ModelSelect() {
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/model")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setModel(data.model);
        setLoading(false);
      })
      .catch(() => {
        setModel(DEFAULT_MODEL);
        setLoading(false);
      });
  }, []);

  async function handleChange(newModel: string) {
    setModel(newModel);
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/settings/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: newModel }),
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
    <div className="space-y-2">
      <select
        value={model}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
      >
        {AVAILABLE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && <p className="text-sm text-accent">Saved</p>}
    </div>
  );
}
