"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  type Deal,
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(reason: TrainReason | null) {
    setBusy(true);
    setError(null);
    try {
      const next =
        reason !== null && existing?.reason === reason
          ? null
          : reason;
      const response = await fetch("/api/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.id, reason: next }),
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
            {TRAIN_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                disabled={busy}
                onClick={() => save(reason)}
                className={`rounded-md border px-2 py-1 text-[11.5px] transition-colors disabled:opacity-50 ${
                  existing?.reason === reason
                    ? "border-flag bg-flag text-canvas"
                    : "border-line bg-surface text-ink-dim"
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
          {existing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => save(null)}
              className="text-ink-faint mt-2 text-[11px] underline disabled:opacity-50"
            >
              Clear flag
            </button>
          )}
          {error && <p className="text-pass mt-1.5 text-[11px]">{error}</p>}
        </div>
      )}
    </div>
  );
}
