"use client";

import { useEffect, useState } from "react";
import type { Conversation, Reminder } from "@/types";

const INPUT_CLASS =
  "rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50";

function scheduleLabel(r: Reminder): string {
  if (r.scheduleType === "recurring") {
    return `cron: ${r.cronExpr} (${r.timezone})`;
  }
  return `once: ${new Date(r.scheduledAt!).toLocaleString()}`;
}

function nextRunLabel(r: Reminder): string {
  if (!r.enabled) return "disabled";
  return new Date(r.nextRunAt).toLocaleString();
}

function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function sortReminders(items: Reminder[]): Reminder[] {
  return [...items].sort(
    (a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime(),
  );
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function RemindersManager() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingForm, setSavingForm] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"notify" | "agent">("notify");
  const [scheduleType, setScheduleType] = useState<"once" | "recurring">(
    "recurring",
  );
  const [cronExpr, setCronExpr] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState(() => defaultTimezone());
  const [conversationId, setConversationId] = useState("");

  const isEditing = editingId !== null;
  const hasConversations = conversations.length > 0;

  useEffect(() => {
    Promise.all([
      fetch("/api/reminders").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/conversations").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([remData, convData]) => {
        setReminders(sortReminders(remData));
        setConversations(convData);
        if (convData.length > 0) {
          setConversationId(convData[0].id);
        }
      })
      .catch(() => setError("Failed to load reminders"))
      .finally(() => setLoading(false));
  }, []);

  function fallbackConversationId(): string {
    return conversations[0]?.id ?? "";
  }

  function resetForm(nextConversationId = fallbackConversationId()) {
    setEditingId(null);
    setName("");
    setMessage("");
    setKind("notify");
    setScheduleType("recurring");
    setCronExpr("");
    setScheduledAt("");
    setTimezone(defaultTimezone());
    setConversationId(nextConversationId);
  }

  function closeForm(nextConversationId = fallbackConversationId()) {
    resetForm(nextConversationId);
    setShowForm(false);
    setError("");
  }

  function openCreateForm() {
    resetForm(fallbackConversationId());
    setShowForm(true);
    setError("");
  }

  function openEditForm(reminder: Reminder) {
    setEditingId(reminder.id);
    setName(reminder.name);
    setMessage(reminder.message);
    setKind(reminder.kind);
    setScheduleType(reminder.scheduleType);
    setCronExpr(reminder.cronExpr ?? "");
    setScheduledAt(toDatetimeLocal(reminder.scheduledAt));
    setTimezone(reminder.timezone);
    setConversationId(reminder.conversationId);
    setShowForm(true);
    setError("");
  }

  function markBusy(id: string) {
    setBusyIds((prev) => new Set(prev).add(id));
  }

  function clearBusy(id: string) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function upsertReminder(updated: Reminder) {
    setReminders((prev) =>
      sortReminders(
        prev.some((item) => item.id === updated.id)
          ? prev.map((item) => (item.id === updated.id ? updated : item))
          : [...prev, updated],
      ),
    );
  }

  function buildFormPayload(): Record<string, unknown> | null {
    const trimmedName = name.trim();
    const trimmedMessage = message.trim();
    const trimmedTimezone = timezone.trim();

    if (!trimmedName || !trimmedMessage) {
      setError("Name and message are required");
      return null;
    }

    if (!trimmedTimezone) {
      setError("Timezone is required");
      return null;
    }

    if (!conversationId) {
      setError("Conversation is required");
      return null;
    }

    const body: Record<string, unknown> = {
      name: trimmedName,
      message: trimmedMessage,
      kind,
      scheduleType,
      timezone: trimmedTimezone,
      conversationId,
    };

    if (scheduleType === "recurring") {
      const trimmedCronExpr = cronExpr.trim();
      if (!trimmedCronExpr) {
        setError("Cron expression is required");
        return null;
      }
      body.cronExpr = trimmedCronExpr;
      return body;
    }

    if (!scheduledAt) {
      setError("Date and time are required");
      return null;
    }

    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      setError("Date and time are invalid");
      return null;
    }

    body.scheduledAt = scheduledDate.toISOString();
    return body;
  }

  async function handleSubmit() {
    setSavingForm(true);
    setError("");

    try {
      const body = buildFormPayload();
      if (!body) return;

      const isEdit = editingId !== null;
      const url = isEdit ? `/api/reminders/${editingId}` : "/api/reminders";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error ||
            `Failed to ${isEdit ? "update" : "create"} reminder`,
        );
        return;
      }

      upsertReminder(data);
      closeForm(conversationId || fallbackConversationId());
    } catch {
      setError("Network error");
    } finally {
      setSavingForm(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    markBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const updated = await res.json();
        upsertReminder(updated);
      } else {
        setError("Failed to update reminder");
      }
    } catch {
      setError("Network error");
    } finally {
      clearBusy(id);
    }
  }

  async function handleDelete(id: string) {
    markBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: "DELETE" });
      if (res.ok) {
        setReminders((prev) => prev.filter((r) => r.id !== id));
        if (editingId === id) {
          closeForm(fallbackConversationId());
        }
      } else {
        setError("Failed to delete reminder");
      }
    } catch {
      setError("Network error");
    } finally {
      clearBusy(id);
    }
  }

  if (loading) {
    return <p className="text-sm text-text-muted">Loading...</p>;
  }

  const canSubmit =
    !savingForm &&
    !!name.trim() &&
    !!message.trim() &&
    !!timezone.trim() &&
    !!conversationId &&
    (scheduleType === "recurring" ? !!cronExpr.trim() : !!scheduledAt);

  return (
    <div className="space-y-3">
      {reminders.length > 0 && (
        <div className="space-y-2">
          {reminders.map((r) => {
            const busy = busyIds.has(r.id);
            return (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-border bg-bg-tertiary px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">
                      {r.name}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                        r.kind === "agent"
                          ? "bg-accent/20 text-accent"
                          : "bg-bg-secondary text-text-muted"
                      }`}
                    >
                      {r.kind === "agent" ? "veille" : "notify"}
                    </span>
                    {r.runningSince && (
                      <span className="text-[10px] uppercase tracking-wide text-text-muted">
                        running...
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-text-muted">
                    {scheduleLabel(r)}
                  </p>
                  <p className="truncate text-xs text-text-muted">{r.message}</p>
                  <p className="text-xs text-text-muted">
                    Next: {nextRunLabel(r)}
                    {r.lastRunAt && (
                      <span>
                        {" "}
                        | Last: {new Date(r.lastRunAt).toLocaleString()}
                      </span>
                    )}
                  </p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => openEditForm(r)}
                    disabled={busy || savingForm}
                    className="text-xs text-text-muted hover:text-text-primary disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggle(r.id, !r.enabled)}
                    disabled={busy}
                    className="text-xs text-text-muted hover:text-text-primary disabled:opacity-50"
                  >
                    {r.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => handleDelete(r.id)}
                    disabled={busy}
                    className="text-xs text-text-muted hover:text-danger disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {reminders.length === 0 && !showForm && (
        <p className="text-sm text-text-muted">
          No reminders scheduled. Create one below or ask the assistant in a
          conversation.
        </p>
      )}

      {showForm ? (
        <div className="space-y-3 rounded-lg border border-border bg-bg-tertiary p-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-muted">
              {isEditing ? "Edit reminder" : "New reminder"}
            </p>
            <p className="text-sm text-text-secondary">
              {isEditing
                ? "Update the reminder content, schedule, destination, or status."
                : "Create a scheduled reminder for one conversation."}
            </p>
          </div>

          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            placeholder="Reminder name"
            disabled={savingForm}
            className={`w-full ${INPUT_CLASS}`}
          />

          <div className="flex items-center gap-3 text-xs text-text-secondary">
            {(
              [
                { value: "notify", label: "Notification" },
                { value: "agent", label: "Veille (agent)" },
              ] as const
            ).map((opt) => (
              <label key={opt.value} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="reminder-kind"
                  value={opt.value}
                  checked={kind === opt.value}
                  onChange={() => {
                    setKind(opt.value);
                    setError("");
                  }}
                  className="accent-accent"
                />
                {opt.label}
              </label>
            ))}
          </div>

          <textarea
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setError("");
            }}
            placeholder={
              kind === "agent"
                ? "Prompt — sent to Pollux as if you typed it in the conversation"
                : "Message shown when the reminder fires"
            }
            rows={kind === "agent" ? 4 : 2}
            disabled={savingForm}
            className={`w-full ${INPUT_CLASS}`}
          />

          <div className="flex items-center gap-3 text-xs text-text-secondary">
            {(["recurring", "once"] as const).map((type) => (
              <label key={type} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="schedule-type"
                  value={type}
                  checked={scheduleType === type}
                  onChange={() => {
                    setScheduleType(type);
                    setError("");
                  }}
                  className="accent-accent"
                />
                {type}
              </label>
            ))}
          </div>

          {scheduleType === "recurring" ? (
            <input
              type="text"
              value={cronExpr}
              onChange={(e) => {
                setCronExpr(e.target.value);
                setError("");
              }}
              placeholder="Cron (e.g. 0 15 * * 5 = Fri 3 PM)"
              disabled={savingForm}
              className={`w-full ${INPUT_CLASS}`}
            />
          ) : (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => {
                setScheduledAt(e.target.value);
                setError("");
              }}
              disabled={savingForm}
              className={`w-full ${INPUT_CLASS}`}
            />
          )}

          <input
            type="text"
            value={timezone}
            onChange={(e) => {
              setTimezone(e.target.value);
              setError("");
            }}
            placeholder="Timezone (e.g. Europe/Paris)"
            disabled={savingForm}
            className={`w-full ${INPUT_CLASS}`}
          />

          <select
            value={conversationId}
            onChange={(e) => {
              setConversationId(e.target.value);
              setError("");
            }}
            disabled={savingForm || !hasConversations}
            className={`w-full ${INPUT_CLASS}`}
          >
            {hasConversations ? (
              conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))
            ) : (
              <option value="">No conversations available</option>
            )}
          </select>

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {savingForm
                ? "Saving..."
                : isEditing
                  ? "Save changes"
                  : "Create"}
            </button>
            <button
              onClick={() => closeForm(conversationId || fallbackConversationId())}
              disabled={savingForm}
              className="rounded-lg border border-border px-4 py-1.5 text-sm text-text-secondary hover:bg-bg-hover disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={openCreateForm}
          className="w-full rounded-lg border border-border bg-bg-tertiary px-4 py-2 text-sm text-text-primary hover:bg-bg-hover"
        >
          Add reminder
        </button>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
