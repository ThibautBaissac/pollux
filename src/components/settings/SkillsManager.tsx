"use client";

import { useEffect, useMemo, useState } from "react";
import { BODY_MAX, DESC_MAX, NAME_REGEX } from "@/lib/skill-constants";

const DESCRIPTION_SOFT = 150;

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50";

const BODY_ENCODER = new TextEncoder();

type SkillIndexEntry = {
  name: string;
  description: string;
  tags: string[];
};

type SkillDiagnostic = { dir: string; reason: string };

type SupportingFileMeta = { path: string; size_bytes: number };

type FullSkill = {
  name: string;
  description: string;
  tags: string[];
  body: string;
  supporting_files: SupportingFileMeta[];
};

type FormState = {
  name: string;
  description: string;
  body: string;
  tagsText: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  body: "",
  tagsText: "",
};

function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export function SkillsManager() {
  const [skills, setSkills] = useState<SkillIndexEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<SkillDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [original, setOriginal] = useState<FullSkill | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [pending, setPending] = useState<"save" | "delete" | null>(null);
  const [formError, setFormError] = useState("");
  const [loadingSkill, setLoadingSkill] = useState(false);

  const editingName = mode === "edit" ? original?.name ?? null : null;
  const supportingFiles = original?.supporting_files ?? [];

  useEffect(() => {
    void loadIndex();
  }, []);

  async function loadIndex() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/skills");
      if (!res.ok) {
        setLoadError("Failed to load skills");
        return;
      }
      const data = (await res.json()) as {
        skills: SkillIndexEntry[];
        diagnostics: SkillDiagnostic[];
      };
      setSkills(data.skills);
      setDiagnostics(data.diagnostics);
    } catch {
      setLoadError("Network error");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setOriginal(null);
    setForm(EMPTY_FORM);
    setFormError("");
  }

  function closeForm() {
    setMode(null);
    resetForm();
  }

  function openCreate() {
    setMode("create");
    resetForm();
  }

  async function openEdit(name: string) {
    setLoadingSkill(true);
    setFormError("");
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
      if (!res.ok) {
        setFormError("Failed to load skill");
        return;
      }
      const data = (await res.json()) as FullSkill;
      setMode("edit");
      setOriginal(data);
      setForm({
        name: data.name,
        description: data.description,
        body: data.body,
        tagsText: tagsToText(data.tags),
      });
    } catch {
      setFormError("Network error");
    } finally {
      setLoadingSkill(false);
    }
  }

  const nameValid = NAME_REGEX.test(form.name);
  const descriptionLen = form.description.length;
  const bodyLen = useMemo(
    () => BODY_ENCODER.encode(form.body).byteLength,
    [form.body],
  );

  const canSubmit =
    pending === null &&
    form.description.trim().length > 0 &&
    form.description.length <= DESC_MAX &&
    bodyLen <= BODY_MAX &&
    (mode === "edit" || nameValid);

  async function handleSave() {
    if (!canSubmit) return;
    setPending("save");
    setFormError("");
    try {
      const tags = parseTags(form.tagsText);
      let res: Response;

      if (mode === "create") {
        res = await fetch("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            description: form.description,
            body: form.body,
            tags,
          }),
        });
      } else if (mode === "edit" && editingName && original) {
        const patch: Record<string, unknown> = {};
        if (form.description !== original.description) {
          patch.description = form.description;
        }
        if (form.body !== original.body) {
          patch.body = form.body;
        }
        if (form.tagsText !== tagsToText(original.tags)) {
          patch.tags = tags;
        }
        if (Object.keys(patch).length === 0) {
          closeForm();
          return;
        }
        res = await fetch(`/api/skills/${encodeURIComponent(editingName)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      } else {
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error || "Failed to save");
        return;
      }

      closeForm();
      await loadIndex();
    } catch {
      setFormError("Network error");
    } finally {
      setPending(null);
    }
  }

  async function handleDelete() {
    if (!editingName) return;
    if (!window.confirm(`Delete skill '${editingName}'? This cannot be undone.`)) {
      return;
    }
    setPending("delete");
    setFormError("");
    try {
      const res = await fetch(
        `/api/skills/${encodeURIComponent(editingName)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error || "Failed to delete");
        return;
      }
      closeForm();
      await loadIndex();
    } catch {
      setFormError("Network error");
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-text-muted">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      {loadError && <p className="text-sm text-danger">{loadError}</p>}

      {diagnostics.length > 0 && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <p className="font-medium">
            {diagnostics.length} skill{diagnostics.length === 1 ? "" : "s"} failed
            to load:
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {diagnostics.map((d) => (
              <li key={d.dir}>
                <span className="font-mono">{d.dir}</span> — {d.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mode === null && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted">
            {skills.length} skill{skills.length === 1 ? "" : "s"}
            {skills.length > 30 && (
              <span className="ml-2 text-danger">
                — large skill indexes inflate every prompt; consider pruning.
              </span>
            )}
          </p>
          <button
            onClick={openCreate}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            + New skill
          </button>
        </div>
      )}

      {mode === null && skills.length === 0 && (
        <p className="rounded-lg border border-border bg-bg-tertiary px-3 py-4 text-center text-sm text-text-muted">
          No skills yet. Create one from a recipe you keep repeating.
        </p>
      )}

      {mode === null && skills.length > 0 && (
        <ul className="space-y-2">
          {skills.map((s) => (
            <li key={s.name}>
              <button
                onClick={() => void openEdit(s.name)}
                disabled={loadingSkill}
                className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-left transition-colors hover:bg-bg-hover disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {s.name}
                  </span>
                  {s.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                  {s.description}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {mode !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">
              {mode === "create" ? "New skill" : `Edit ${editingName}`}
            </h3>
            <button
              onClick={closeForm}
              disabled={pending !== null}
              className="text-sm text-text-muted hover:text-text-primary disabled:opacity-50"
            >
              Back
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">
              Name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
              disabled={mode === "edit"}
              placeholder="weekly-review"
              className={INPUT_CLASS}
            />
            {mode === "create" && form.name.length > 0 && !nameValid && (
              <p className="text-xs text-danger">
                Must be kebab-case, 2–48 chars, start with a letter.
              </p>
            )}
            {mode === "edit" && (
              <p className="text-xs text-text-muted">
                Rename by deleting and recreating the skill.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">
                Description
              </label>
              <span
                className={`text-xs ${
                  descriptionLen > DESC_MAX
                    ? "text-danger"
                    : descriptionLen > DESCRIPTION_SOFT
                      ? "text-text-secondary"
                      : "text-text-muted"
                }`}
              >
                {descriptionLen}/{DESC_MAX}
              </span>
            </div>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="One-sentence summary — this is what's injected into the system prompt."
              className={`${INPUT_CLASS} min-h-[60px] resize-y`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={form.tagsText}
              onChange={(e) =>
                setForm((f) => ({ ...f, tagsText: e.target.value }))
              }
              placeholder="productivity, writing"
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">
                Body (markdown)
              </label>
              <span
                className={`text-xs ${
                  bodyLen > BODY_MAX ? "text-danger" : "text-text-muted"
                }`}
              >
                {formatBytes(bodyLen)} / {formatBytes(BODY_MAX)}
              </span>
            </div>
            <textarea
              value={form.body}
              onChange={(e) =>
                setForm((f) => ({ ...f, body: e.target.value }))
              }
              placeholder="## When to use&#10;...&#10;&#10;## Steps&#10;1. ..."
              className={`${INPUT_CLASS} min-h-[400px] resize-y font-mono`}
            />
          </div>

          {mode === "edit" && supportingFiles.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                Supporting files
              </label>
              <ul className="rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-xs text-text-muted">
                {supportingFiles.map((f) => (
                  <li key={f.path} className="flex justify-between gap-2">
                    <span className="truncate font-mono">{f.path}</span>
                    <span className="shrink-0">{formatBytes(f.size_bytes)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-muted">
                Managed directly on disk under{" "}
                <span className="font-mono">data/skills/{editingName}/</span>.
              </p>
            </div>
          )}

          {formError && <p className="text-sm text-danger">{formError}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleSave()}
              disabled={!canSubmit}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {pending === "save" ? "Saving..." : "Save"}
            </button>
            <button
              onClick={closeForm}
              disabled={pending !== null}
              className="rounded-lg border border-border bg-bg-tertiary px-4 py-2 text-sm text-text-primary hover:bg-bg-hover disabled:opacity-50"
            >
              Cancel
            </button>
            {mode === "edit" && (
              <button
                onClick={() => void handleDelete()}
                disabled={pending !== null}
                className="ml-auto rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/20 disabled:opacity-50"
              >
                {pending === "delete" ? "Deleting..." : "Delete"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
