"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import {
  type Deal,
  isTrainListingReason,
  type MemberId,
  TRAIN_CRITERIA_REASON_BY_INTENT,
  TRAIN_LISTING_REASONS,
  type TrainCriteriaIntent,
  type TrainListingReason,
  type TrainTheme,
} from "@/lib/model";

/**
 * Train AI: listing capture errors (→ repertoire) or criteria signals
 * (should-be-excluded / request criteria change — buy-box queue only).
 *
 * Portal overlay so the sheet stays scrollable inside the height-locked swipe card.
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

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<TrainTheme | null>(null);
  const [listingReason, setListingReason] = useState<TrainListingReason | null>(null);
  const [criteriaIntent, setCriteriaIntent] = useState<TrainCriteriaIntent | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setTheme(existing.theme);
      setListingReason(isTrainListingReason(existing.reason) ? existing.reason : null);
      setCriteriaIntent(existing.criteria_intent);
      setNotes(existing.detail ?? "");
    } else {
      setTheme(null);
      setListingReason(null);
      setCriteriaIntent(null);
      setNotes("");
    }
    setError(null);
  }, [open, existing]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function pickTheme(next: TrainTheme) {
    setTheme(next);
    setListingReason(null);
    setCriteriaIntent(null);
    setError(null);
    if (next === "listing") setNotes(existing?.theme === "listing" ? (existing.detail ?? "") : "");
    if (next === "criteria") setNotes(existing?.theme === "criteria" ? (existing.detail ?? "") : "");
  }

  async function save(clear = false) {
    if (clear) {
      if (!existing) {
        setOpen(false);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/train", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId: deal.id, reason: null }),
        });
        if (!response.ok) throw new Error("rejected");
        setOpen(false);
        router.refresh();
      } catch {
        setError("Could not clear that flag.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!theme) {
      setError("Pick Listing error or Criteria first.");
      return;
    }

    let reason: string;
    let intent: TrainCriteriaIntent | null = null;
    let detail: string | null = notes.trim() ? notes.trim().slice(0, 500) : null;

    if (theme === "listing") {
      if (!listingReason) {
        setError("Pick what’s wrong with the listing.");
        return;
      }
      reason = listingReason;
    } else {
      if (!criteriaIntent) {
        setError("Pick Should be excluded or Request criteria change.");
        return;
      }
      intent = criteriaIntent;
      reason = TRAIN_CRITERIA_REASON_BY_INTENT[criteriaIntent];
      if (criteriaIntent === "criteria_change" && !detail) {
        setError("Describe the criteria change — hard rules already have exceptions.");
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: deal.id,
          theme,
          criteriaIntent: intent,
          reason,
          detail,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "rejected");
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message !== "rejected" ? err.message : "Could not save that flag.");
    } finally {
      setBusy(false);
    }
  }

  const canSave =
    theme === "listing"
      ? Boolean(listingReason)
      : theme === "criteria"
        ? criteriaIntent === "exclusion_miss" ||
          (criteriaIntent === "criteria_change" && notes.trim().length > 0)
        : false;

  const flagLabel = existing
    ? existing.theme === "criteria"
      ? `Train AI · ${existing.reason}`
      : `Train AI · ${existing.reason}${existing.format_id ? ` · ${existing.format_id}` : ""}`
    : "Train AI";

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
                <p className="text-ink-faint mb-2 text-[12px] font-medium">What kind of feedback?</p>
                <div className="mb-4 grid gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pickTheme("listing")}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                      theme === "listing"
                        ? "border-flag bg-flag-bg"
                        : "border-line bg-surface-raised"
                    }`}
                  >
                    <span className="block text-[13px] font-semibold">Listing error</span>
                    <span className="text-ink-faint mt-0.5 block text-[11.5px] leading-snug">
                      Wrong capture / parse — routes to the format repertoire.
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pickTheme("criteria")}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                      theme === "criteria"
                        ? "border-flag bg-flag-bg"
                        : "border-line bg-surface-raised"
                    }`}
                  >
                    <span className="block text-[13px] font-semibold">Criteria</span>
                    <span className="text-ink-faint mt-0.5 block text-[11.5px] leading-snug">
                      Filter / buy-box signal — queued only; does not change shortlist or pass.
                    </span>
                  </button>
                </div>

                {theme === "listing" && (
                  <>
                    <p className="text-ink-faint mb-2 text-[12px] leading-relaxed">
                      What’s wrong?
                    </p>
                    {existing?.theme === "listing" &&
                      existing.inspection &&
                      Array.isArray(
                        (existing.inspection as { checklist?: unknown }).checklist,
                      ) && (
                        <ul className="text-ink-faint mb-3 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed">
                          {(
                            (existing.inspection as { checklist: string[] }).checklist || []
                          )
                            .slice(0, 3)
                            .map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                        </ul>
                      )}
                    <div className="flex flex-wrap gap-1.5">
                      {TRAIN_LISTING_REASONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          disabled={busy}
                          onClick={() => setListingReason(option)}
                          className={`rounded-md border px-2.5 py-1.5 text-[12px] transition-colors disabled:opacity-50 ${
                            listingReason === option
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
                        rows={3}
                        maxLength={500}
                        placeholder="e.g. Revenue is $50M not $15M…"
                        className="border-line bg-surface-raised text-ink placeholder:text-ink-faint w-full resize-y rounded-md border px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-flag disabled:opacity-50"
                      />
                    </label>
                  </>
                )}

                {theme === "criteria" && (
                  <>
                    <p className="text-ink-faint mb-2 text-[12px] leading-relaxed">
                      What don’t you like?
                    </p>
                    <div className="mb-3 grid gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setCriteriaIntent("exclusion_miss")}
                        className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                          criteriaIntent === "exclusion_miss"
                            ? "border-flag bg-flag-bg"
                            : "border-line bg-surface-raised"
                        }`}
                      >
                        <span className="block text-[13px] font-semibold">Should be excluded</span>
                        <span className="text-ink-faint mt-0.5 block text-[11.5px] leading-snug">
                          Current rules should already have kept this out — it slipped in.
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setCriteriaIntent("criteria_change")}
                        className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                          criteriaIntent === "criteria_change"
                            ? "border-flag bg-flag-bg"
                            : "border-line bg-surface-raised"
                        }`}
                      >
                        <span className="block text-[13px] font-semibold">
                          Request criteria change
                        </span>
                        <span className="text-ink-faint mt-0.5 block text-[11.5px] leading-snug">
                          Nuanced thesis note — describe what should change and why.
                        </span>
                      </button>
                    </div>

                    {criteriaIntent === "exclusion_miss" && (
                      <label className="block">
                        <span className="text-ink-faint mb-1 block text-[11.5px]">
                          Notes (optional)
                        </span>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          disabled={busy}
                          rows={3}
                          maxLength={500}
                          placeholder="e.g. Clear restaurant / franchise — exclude keyword miss…"
                          className="border-line bg-surface-raised text-ink placeholder:text-ink-faint w-full resize-y rounded-md border px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-flag disabled:opacity-50"
                        />
                      </label>
                    )}

                    {criteriaIntent === "criteria_change" && (
                      <label className="block">
                        <span className="text-ink-faint mb-1 block text-[11.5px]">
                          What should change? (required)
                        </span>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          disabled={busy}
                          rows={5}
                          maxLength={500}
                          placeholder="Hard rules already exist and most have exceptions — describe the nuance…"
                          className="border-line bg-surface-raised text-ink placeholder:text-ink-faint w-full resize-y rounded-md border px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-flag disabled:opacity-50"
                        />
                      </label>
                    )}
                  </>
                )}

                {error && <p className="text-pass mt-2 text-[12px]">{error}</p>}
              </div>

              <div className="border-line flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  disabled={busy || !canSave}
                  onClick={() => save(false)}
                  className="bg-flag text-canvas rounded-md px-3 py-2 text-[12.5px] font-medium disabled:opacity-50"
                >
                  {busy ? "Saving…" : existing ? "Update" : "Save"}
                </button>
                {existing && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => save(true)}
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
          existing ? "text-flag font-semibold" : "text-ink-faint hover:text-ink-dim"
        }`}
        title="Flag a listing error or criteria signal"
      >
        {flagLabel}
      </button>
      {panel}
    </div>
  );
}
