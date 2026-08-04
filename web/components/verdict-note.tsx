"use client";

import { useEffect, useState } from "react";

/** Free-text note shown when a member shortlists or marks discuss. */
export function VerdictNoteField({
  action,
  note,
  onSave,
  disabled = false,
  autofocus = false,
  compact = false,
}: {
  action: "short" | "discuss";
  note: string | null;
  onSave: (note: string | null) => void;
  disabled?: boolean;
  autofocus?: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(note ?? "");

  useEffect(() => {
    setDraft(note ?? "");
  }, [note]);

  const trimmed = draft.trim();
  const stored = (note ?? "").trim();
  const dirty = trimmed !== stored;

  function commit() {
    if (!dirty) return;
    onSave(trimmed ? trimmed.slice(0, 500) : null);
  }

  const label =
    action === "short"
      ? "Note for your partner (optional)"
      : "What should you discuss? (optional)";

  return (
    <div className={compact ? "space-y-2" : "border-line space-y-2 border-t border-dashed pt-3"}>
      <p className="text-ink-faint text-xs font-semibold">{label}</p>
      <textarea
        value={draft}
        disabled={disabled}
        autoFocus={autofocus}
        rows={compact ? 2 : 3}
        maxLength={500}
        placeholder="Add a note…"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className="border-line bg-surface text-ink placeholder:text-ink-faint focus:border-line-bright w-full resize-y rounded-lg border px-3 py-2 text-[13px] leading-relaxed outline-none"
      />
      {dirty && (
        <button
          type="button"
          disabled={disabled}
          onClick={commit}
          className="border-line bg-surface-raised text-ink hover:bg-ink hover:text-canvas rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
        >
          Save note
        </button>
      )}
    </div>
  );
}
