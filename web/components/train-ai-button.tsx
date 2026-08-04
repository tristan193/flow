"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

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
 *
 * The panel is a fixed overlay (not an inline expand) so it stays scrollable
 * on mobile when the swipe card itself is height-locked.
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
  const titleId = useId();
  const existing = deal.trainFlags[member];
  const existingReason =
    existing && isTrainReason(existing.reason) ? existing.reason : null;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [reason, setReason] = useState<TrainReason | null>(existingReason);
  const [notes, setNotes] = useState(existing?.detail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setReason(existingReason);
    setNotes(existing?.detail ?? "");
    setError(null);
  }, [open, existingReason, existing?.detail]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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

  const panel =
    open && mounted
      ? createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 bg-black/55"
              onClick={() => !busy && setOpen(false)}
            />
            <div className="border-line bg-surface relative z-[1] flex max-h-[88vh] w-full flex-col rounded-t-2xl border sm:max-w-md sm:rounded-xl">
              <div className="border-line flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
                <div>
                  <p id={titleId} className="text-[14px] font-semibold">
                    Train AI
                  </p>
                  <p className="text-ink-faint mt-0.5 line-clamp-2 text-[11.5px] leading-snug">
                    {deal.title}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="text-ink-faint hover:text-ink shrink-0 px-1 text-[18px] leading-none disabled:opacity-50"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                <p className="text-ink-faint mb-3 text-[12px] leading-relaxed">
                  What’s wrong with how this listing was captured? Flags the matching
                  format in the repertoire — doesn’t change shortlist / pass.
                </p>
                {existing?.inspection &&
                  Array.isArray(
                    (existing.inspection as { checklist?: unknown }).checklist,
                  ) && (
                    <ul className="text-ink-faint mb-3 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed">
                      {(
                        (existing.inspection as { checklist: string[] }).checklist ||
                        []
                      )
                        .slice(0, 3)
                        .map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                    </ul>
                  )}
                <div className="flex flex-wrap gap-1.5">
                  {TRAIN_REASONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={busy}
                      onClick={() => setReason(option)}
                      className={`rounded-md border px-2.5 py-1.5 text-[12px] transition-colors disabled:opacity-50 ${
                        reason === option
                          ? "border-flag bg-flag text-canvas"
                          : "border-line bg-surface-raised text-ink-dim"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <label className="mt-3 block">
                  <span className="text-ink-faint mb-1 block text-[11.5px]">
                    Notes (optional)
                  </span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={busy}
                    rows={4}
                    maxLength={500}
                    placeholder="e.g. Title pulled the wrong line; EBITDA is actually SDE…"
                    className="border-line bg-surface-raised text-ink placeholder:text-ink-faint w-full resize-y rounded-md border px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-flag disabled:opacity-50"
                  />
                </label>
                {error && <p className="text-pass mt-2 text-[12px]">{error}</p>}
              </div>

              <div className="border-line flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  disabled={busy || !reason}
                  onClick={() => save(reason)}
                  className="bg-flag text-canvas rounded-md px-3 py-2 text-[12.5px] font-medium disabled:opacity-50"
                >
                  {busy ? "Saving…" : existing ? "Update" : "Save"}
                </button>
                {existing && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => save(null)}
                    className="text-ink-faint text-[12px] underline disabled:opacity-50"
                  >
                    Clear flag
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="text-ink-faint ml-auto text-[12px] disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

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
        title="Flag a bad parse so we can improve the format repertoire"
      >
        {existing
          ? `Train AI · ${existing.reason}${existing.format_id ? ` · ${existing.format_id}` : ""}`
          : "Train AI"}
      </button>
      {panel}
    </div>
  );
}
