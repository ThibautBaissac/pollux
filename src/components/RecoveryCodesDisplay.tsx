"use client";

import { useState } from "react";

export function RecoveryCodesDisplay({
  codes,
  doneLabel = "Done",
  onDone,
}: {
  codes: string[];
  doneLabel?: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        Save these codes somewhere safe. You will not see them again.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {codes.map((code) => (
          <code
            key={code}
            className="rounded bg-bg-tertiary px-2 py-1.5 text-center text-sm text-text-primary"
          >
            {code}
          </code>
        ))}
      </div>
      <button
        onClick={handleCopy}
        className="w-full rounded-lg border border-border bg-bg-secondary px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-hover"
      >
        {copied ? "Copied!" : "Copy all codes"}
      </button>
      <button
        onClick={onDone}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
      >
        {doneLabel}
      </button>
    </div>
  );
}
