"use client";

import { useState, useEffect } from "react";

type ServerType = "stdio" | "http" | "sse";

interface ServerEntry {
  type?: ServerType;
  command?: string;
  args?: string[];
  url?: string;
}

type ServersMap = Record<string, ServerEntry>;

function serverSummary(server: ServerEntry): string {
  const type = server.type ?? "stdio";
  if (type === "stdio") {
    const cmd = server.command ?? "";
    const args = server.args?.join(" ") ?? "";
    return args ? `${cmd} ${args}` : cmd;
  }
  return server.url ?? "";
}

export function McpServersEditor() {
  const [servers, setServers] = useState<ServersMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [type, setType] = useState<ServerType>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    fetch("/api/settings/mcp")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setServers(data.servers ?? {});
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  async function saveServers(updated: ServersMap) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ servers: updated }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
        return;
      }
      setServers(data.servers);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  function handleAdd() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Server name is required");
      return;
    }
    if (trimmedName in servers) {
      setError("A server with this name already exists");
      return;
    }

    let entry: ServerEntry;
    if (type === "stdio") {
      if (!command.trim()) {
        setError("Command is required");
        return;
      }
      const parsedArgs = args.trim()
        ? args.trim().split(/\s+/)
        : undefined;
      entry = { command: command.trim(), args: parsedArgs };
    } else {
      if (!url.trim()) {
        setError("URL is required");
        return;
      }
      entry = { type, url: url.trim() };
    }

    const updated = { ...servers, [trimmedName]: entry };
    saveServers(updated);
    setName("");
    setCommand("");
    setArgs("");
    setUrl("");
  }

  function handleRemove(serverName: string) {
    const updated = { ...servers };
    delete updated[serverName];
    saveServers(updated);
  }

  if (loading) {
    return <p className="text-sm text-text-muted">Loading...</p>;
  }

  const entries = Object.entries(servers);

  return (
    <div className="space-y-3">
      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(([serverName, server]) => (
            <div
              key={serverName}
              className="flex items-center justify-between rounded-lg border border-border bg-bg-tertiary px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-text-primary">
                  {serverName}
                </span>
                <span className="ml-2 text-xs text-text-muted">
                  ({server.type ?? "stdio"})
                </span>
                <p className="truncate text-xs text-text-muted">
                  {serverSummary(server)}
                </p>
              </div>
              <button
                onClick={() => handleRemove(serverName)}
                disabled={saving}
                className="ml-3 shrink-0 text-xs text-text-muted hover:text-danger disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border bg-bg-tertiary p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(""); }}
            placeholder="Server name"
            disabled={saving}
            className="flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center gap-3 text-xs text-text-secondary">
            {(["stdio", "http", "sse"] as const).map((t) => (
              <label key={t} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="mcp-type"
                  value={t}
                  checked={type === t}
                  onChange={() => { setType(t); setError(""); }}
                  className="accent-accent"
                />
                {t}
              </label>
            ))}
          </div>
        </div>

        {type === "stdio" ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={command}
              onChange={(e) => { setCommand(e.target.value); setError(""); }}
              placeholder="Command (e.g. npx)"
              disabled={saving}
              className="flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <input
              type="text"
              value={args}
              onChange={(e) => { setArgs(e.target.value); setError(""); }}
              placeholder="Args (space-separated)"
              disabled={saving}
              className="flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50"
            />
          </div>
        ) : (
          <input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(""); }}
            placeholder="URL (e.g. https://example.com/mcp)"
            disabled={saving}
            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50"
          />
        )}

        <button
          onClick={handleAdd}
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? "Saving..." : "Add Server"}
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
