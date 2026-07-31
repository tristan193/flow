"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  type Deal,
  isTrainReason,
  type MemberId,
  TRAIN_REASONS,
  type TrainReason,
} from "@/lib/model";

/**
 * Discreet extraction-feedback control.
 *
 * Lives beside triage actions but never replaces them — shortlist/pass/discuss
 * stay intact so a bad parse can still be a good deal (or vice versa).
 */
export function TrainAiButton({
  deal,
  member,
  compact = false,
}: {
  deal: Deal;
  member: MemberId;
  compact?: boolean;
}) {
  const router = useRouter();
  const existing = deal.trainFlags[member];
  const existingReason =
    existing && isTrainReason(existing.reason) ? existing.reason : null;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<TrainReason | null>(existingReason);
  const [notes, setNotes] = useState(existing?.detail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason(existingReason);
    setNotes(existing?.detail ?? "");
    setError(null);
  }, [open, existingReason, existing?.detail]);

  async function save(nextReason: TrainReason | null = reason) {
    if (nextReason === null && !existing) {
      setOpen(false);
      return;
    }
    if (nextReason !== null && !TRAIN_REASONS.includes(nextReason)) {
      setError("Pick what’s wrong first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: deal.id,
          reason: nextReason,
          detail:
            nextReason === null
              ? null
              : notes.trim()
                ? notes.trim().slice(0, 500)
                : null,
        }),
      });
      if (!response.ok) throw new Error("rejected");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not save that flag.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? "" : "mt-2"}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`text-[11.5px] underline-offset-2 ${
          existing
            ? "text-flag font-semibold"
            : "text-ink-faint hover:text-ink-dim"
        }`}
        title="Flag a bad parse so we can improve the harvest"
      >
        {existing ? `Train AI · ${existing.reason}` : "Train AI"}
      </button>

      {open && (
        <div className="border-line bg-surface-raised mt-2 rounded-lg border p-2.5">
          <p className="text-ink-faint mb-2 text-[11px] leading-relaxed">
            What’s wrong with how this listing was captured? Doesn’t change your
            shortlist / pass.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TRAIN_REASONS.map((option) => (
              <button
                key={option}
                type="button"
                disabled={busy}
                onClick={() => setReason(option)}
                className={`rounded-md border px-2 py-1 text-[11.5px] transition-colors disabled:opacity-50 ${
                  reason === option
                    ? "border-flag bg-flag text-canvas"
                    : "border-line bg-surface text-ink-dim"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <label className="mt-2.5 block">
            <span className="text-ink-faint mb-1 block text-[11px]">
              Notes (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
              rows={3}
              maxLength={500}
              placeholder="e.g. Title pulled the wrong line; EBITDA is actually SDE…"
              className="border-line bg-surface text-ink placeholder:text-ink-faint w-full resize-y rounded-md border px-2.5 py-2 text-[12.5px] leading-relaxed outline-none focus:border-flag disabled:opacity-50"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !reason}
              onClick={() => save(reason)}
              className="bg-flag text-canvas rounded-md px-2.5 py-1 text-[11.5px] font-medium disabled:opacity-50"
            >
              {busy ? "Saving…" : existing ? "Update" : "Save"}
            </button>
            {existing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => save(null)}
                className="text-ink-faint text-[11px] underline disabled:opacity-50"
              >
                Clear flag
              </button>
            )}
          </div>
          {error && <p className="text-pass mt-1.5 text-[11px]">{error}</p>}
        </div>
      )}
    </div>
  );
}
