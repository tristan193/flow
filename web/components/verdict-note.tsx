"use client";

import { useEffect, useState } from "react";

/** Modal that pops after shortlist / discuss — optional note for your partner. */
export function VerdictNotePrompt({
  action,
  title,
  note,
  onSave,
  onSkip,
}: {
  action: "short" | "discuss";
  title: string;
  note: string | null;
  onSave: (note: string | null) => void;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState(note ?? "");

  useEffect(() => {
    setDraft(note ?? "");
  }, [note]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onSkip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  const trimmed = draft.trim();
  const label =
    action === "short"
      ? "Note for your partner (optional)"
      : "What should you discuss? (optional)";

  function save() {
    onSave(trimmed ? trimmed.slice(0, 500) : null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verdict-note-title"
      onClick={onSkip}
    >
      <div
        className="border-line bg-surface w-full max-w-md space-y-3 rounded-2xl border px-4 py-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <p id="verdict-note-title" className="text-ink text-[15px] font-semibold">
            {action === "short" ? "Shortlisted" : "Marked to discuss"}
          </p>
          <p className="text-ink-dim mt-0.5 line-clamp-2 text-[13px]">{title}</p>
        </div>

        <div className="space-y-2">
          <p className="text-ink-faint text-xs font-semibold">{label}</p>
          <textarea
            value={draft}
            autoFocus
            rows={3}
            maxLength={500}
            placeholder="Add a note…"
            onChange={(event) => setDraft(event.target.value)}
            className="border-line bg-surface-raised text-ink placeholder:text-ink-faint focus:border-line-bright w-full resize-y rounded-lg border px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="border-line bg-surface-raised text-ink-dim hover:text-ink flex-1 rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={save}
            className="bg-ink text-canvas hover:brightness-110 flex-1 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-[filter]"
          >
            {trimmed ? "Save note" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
