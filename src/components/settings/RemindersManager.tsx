"use client";

import { useState, useEffect } from "react";
import type { Reminder, Conversation } from "@/types";

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

export function RemindersManager() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [scheduleType, setScheduleType] = useState<"once" | "recurring">(
    "recurring",
  );
  const [cronExpr, setCronExpr] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [conversationId, setConversationId] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/reminders").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/conversations").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([remData, convData]) => {
        setReminders(remData);
        setConversations(convData);
        if (convData.length > 0) {
          setConversationId(convData[0].id);
        }
      })
      .catch(() => setError("Failed to load reminders"))
      .finally(() => setLoading(false));
  }, []);

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

  async function handleCreate() {
    setCreating(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        message: message.trim(),
        scheduleType,
        timezone,
        conversationId,
      };
      if (scheduleType === "recurring") {
        body.cronExpr = cronExpr.trim();
      } else {
        body.scheduledAt = new Date(scheduledAt).toISOString();
      }

      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create reminder");
        return;
      }
      setReminders((prev) => [...prev, data]);
      setName("");
      setMessage("");
      setCronExpr("");
      setScheduledAt("");
      setShowForm(false);
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
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
        setReminders((prev) => prev.map((r) => (r.id === id ? updated : r)));
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
                  <span className="text-sm font-medium text-text-primary">
                    {r.name}
                  </span>
                  <p className="truncate text-xs text-text-muted">
                    {scheduleLabel(r)}
                  </p>
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
        <div className="space-y-2 rounded-lg border border-border bg-bg-tertiary p-3">
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            placeholder="Reminder name"
            disabled={creating}
            className={`w-full ${INPUT_CLASS}`}
          />

          <textarea
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setError("");
            }}
            placeholder="Message shown when the reminder fires"
            rows={2}
            disabled={creating}
            className={`w-full ${INPUT_CLASS}`}
          />

          <div className="flex items-center gap-3 text-xs text-text-secondary">
            {(["recurring", "once"] as const).map((t) => (
              <label key={t} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="schedule-type"
                  value={t}
                  checked={scheduleType === t}
                  onChange={() => {
                    setScheduleType(t);
                    setError("");
                  }}
                  className="accent-accent"
                />
                {t}
              </label>
            ))}
          </div>

          {scheduleType === "recurring" ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={cronExpr}
                onChange={(e) => {
                  setCronExpr(e.target.value);
                  setError("");
                }}
                placeholder="Cron (e.g. 0 15 * * 5 = Fri 3 PM)"
                disabled={creating}
                className={`flex-1 ${INPUT_CLASS}`}
              />
              <input
                type="text"
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  setError("");
                }}
                placeholder="Timezone"
                disabled={creating}
                className={`w-48 ${INPUT_CLASS}`}
              />
            </div>
          ) : (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => {
                setScheduledAt(e.target.value);
                setError("");
              }}
              disabled={creating}
              className={`w-full ${INPUT_CLASS}`}
            />
          )}

          <select
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            disabled={creating}
            className={`w-full ${INPUT_CLASS}`}
          >
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim() || !message.trim()}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {creating ? "Saving..." : "Create"}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setError("");
              }}
              disabled={creating}
              className="rounded-lg border border-border px-4 py-1.5 text-sm text-text-secondary hover:bg-bg-hover disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-lg border border-border bg-bg-tertiary px-4 py-2 text-sm text-text-primary hover:bg-bg-hover"
        >
          Add reminder
        </button>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
