"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Fit, type FitLevel, assessFit, byFit } from "@/lib/fit";
import {
  type Deal,
  isTeamShortlist,
  type MemberId,
  PASS_REASONS,
  type VerdictAction,
} from "@/lib/model";
import {
  CardFooter,
  DealListCard,
  FitStrip,
  LeadLine,
  MetricRow,
  VerdictChips,
  Where,
} from "./deal-card";
import { BlurbText } from "./blurb-text";
import { TrainAiButton } from "./train-ai-button";
import { VerdictNoteField } from "./verdict-note";

type Override = { action: VerdictAction | null; reason: string | null; note: string | null };
type Scored = Deal & { fit: Fit };
type NotePrompt = { id: number; title: string; action: "short" | "discuss" };

const FILTERS = [
  { id: "todo", label: "To review" },
  { id: "priority", label: "Priority" },
  { id: "inbox", label: "In the box" },
  { id: "unknown", label: "No financials" },
  { id: "out", label: "Out of box" },
  { id: "short", label: "Shortlisted" },
  { id: "discuss", label: "To discuss" },
  { id: "needs", label: "Needs info" },
  { id: "train", label: "Train AI" },
  { id: "all", label: "Everything" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

export function ReviewClient({ deals, member }: { deals: Deal[]; member: MemberId }) {
  const router = useRouter();
  const [mode, setMode] = useState<"swipe" | "list">("swipe");
  const [filter, setFilter] = useState<FilterId>("todo");
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [history, setHistory] = useState<{ id: number; kind: "verdict" | "skip" }[]>(
    [],
  );
  // Session-only skips: advance the deck without a verdict (comes back on refresh).
  const [skipped, setSkipped] = useState<number[]>([]);
  const [failed, setFailed] = useState(false);
  const [notePrompt, setNotePrompt] = useState<NotePrompt | null>(null);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 2500);
  }, [router]);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const scored = useMemo<Scored[]>(
    () => deals.map((deal) => ({ ...deal, fit: assessFit(deal) })),
    [deals],
  );

  const verdictOf = useCallback(
    (deal: Deal): Override | null => {
      const override = overrides[deal.id];
      if (override !== undefined) return override.action === null ? null : override;
      const stored = deal.verdicts[member];
      return stored
        ? { action: stored.action, reason: stored.reason, note: stored.note }
        : null;
    },
    [overrides, member],
  );

  const send = useCallback(
    async (
      dealId: number,
      action: VerdictAction | null,
      reason: string | null,
      note: string | null,
    ) => {
      try {
        const response = await fetch("/api/verdict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId, action, reason, note }),
        });
        if (!response.ok) throw new Error("rejected");
        setFailed(false);
        scheduleRefresh();
      } catch {
        setFailed(true);
      }
    },
    [scheduleRefresh],
  );

  const apply = useCallback(
    (
      deal: Deal,
      action: VerdictAction | null,
      reason: string | null = null,
      note: string | null = null,
    ) => {
      setOverrides((prev) => ({ ...prev, [deal.id]: { action, reason, note } }));
      void send(deal.id, action, reason, note);
    },
    [send],
  );

  const toggle = useCallback(
    (deal: Deal, action: VerdictAction) => {
      const current = verdictOf(deal);
      if (current?.action === action) apply(deal, null);
      else {
        apply(
          deal,
          action,
          action === "pass" ? (current?.reason ?? null) : null,
          action === "pass" ? null : (current?.note ?? null),
        );
      }
    },
    [apply, verdictOf],
  );

  const commitSwipe = useCallback(
    (deal: Deal, action: VerdictAction) => {
      setHistory((prev) => [...prev, { id: deal.id, kind: "verdict" }]);
      setSkipped((prev) => prev.filter((id) => id !== deal.id));
      apply(deal, action);
      if (action === "short" || action === "discuss") {
        setNotePrompt({ id: deal.id, title: deal.title, action });
      } else {
        setNotePrompt(null);
      }
    },
    [apply],
  );

  const skipDeal = useCallback((deal: Deal) => {
    setHistory((prev) => [...prev, { id: deal.id, kind: "skip" }]);
    setSkipped((prev) => (prev.includes(deal.id) ? prev : [...prev, deal.id]));
    setNotePrompt(null);
  }, []);

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((prev) => prev.slice(0, -1));
    if (last.kind === "skip") {
      setSkipped((prev) => prev.filter((id) => id !== last.id));
      return;
    }
    setOverrides((prev) => ({ ...prev, [last.id]: { action: null, reason: null, note: null } }));
    void send(last.id, null, null, null);
    setNotePrompt((prev) => (prev?.id === last.id ? null : prev));
  }, [history, send]);

  const savePromptNote = useCallback(
    (note: string | null) => {
      if (!notePrompt) return;
      const deal = scored.find((row) => row.id === notePrompt.id);
      if (deal) apply(deal, notePrompt.action, null, note);
      setNotePrompt(null);
    },
    [notePrompt, scored, apply],
  );

  const queue = useMemo(
    () =>
      scored
        .filter((deal) => !verdictOf(deal) && !skipped.includes(deal.id))
        .sort(byFit),
    [scored, verdictOf, skipped],
  );

  const remaining = useMemo(() => {
    const counts: Record<FitLevel, number> = {
      priority: 0,
      fits: 0,
      unknown: 0,
      low: 0,
      out: 0,
    };
    for (const deal of queue) counts[deal.fit.level] += 1;
    return counts;
  }, [queue]);

  const visible = useMemo(() => {
    const rows = scored.filter((deal) => {
      const verdict = verdictOf(deal);
      const myAction = verdict?.action ?? null;

      // Pass hides the deal from this member's views. It only resurfaces under
      // Shortlisted when the other partner shortlists.
      if (myAction === "pass" && filter !== "short") return false;

      switch (filter) {
        case "todo":
          return !verdict;
        case "priority":
          return deal.fit.level === "priority";
        case "inbox":
          return deal.fit.level === "priority" || deal.fit.level === "fits";
        case "unknown":
          return deal.fit.level === "unknown";
        case "out":
          return deal.fit.level === "out" || deal.fit.level === "low";
        case "needs":
          return deal.needs_llm.length > 0;
        case "short":
          // Either partner short, or both discuss.
          return isTeamShortlist(deal, member, myAction);
        case "discuss":
          return (
            myAction === "discuss" ||
            deal.verdicts.tristan?.action === "discuss" ||
            deal.verdicts.partner?.action === "discuss"
          );
        case "train":
          return Boolean(
            deal.trainFlags[member] || deal.trainFlags.tristan || deal.trainFlags.partner,
          );
        default:
          return true;
      }
    });
    return rows.sort(byFit);
  }, [scored, filter, verdictOf, member]);

  return (
    <div className="space-y-3">
      <div className="border-line bg-surface flex gap-1 rounded-xl border p-1">
        {(["swipe", "list"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`flex-1 rounded-lg px-3 py-2 text-[13.5px] font-semibold capitalize transition-colors ${
              mode === value
                ? "bg-surface-raised text-ink"
                : "text-ink-faint hover:bg-surface-raised/60 hover:text-ink-dim"
            }`}
          >
            {value === "swipe" ? "Swipe" : "List"}
          </button>
        ))}
      </div>

      <QueueMeter counts={remaining} total={queue.length} reviewed={deals.length - queue.length} />

      {failed && (
        <p className="bg-pass-bg text-pass rounded-lg px-3 py-2 text-xs">
          Could not save that to the server. Your last action is showing locally but is not stored
          yet — check your connection.
        </p>
      )}

      {mode === "swipe" ? (
        <>
          <SwipeDeck
            queue={queue}
            total={deals.length}
            member={member}
            onCommit={commitSwipe}
            onSkip={skipDeal}
            onUndo={undo}
            canUndo={history.length > 0}
            onBrowse={() => setMode("list")}
          />
          {notePrompt && (
            <div className="border-line bg-surface space-y-2 rounded-xl border px-3.5 py-3">
              <p className="text-ink-dim text-[13px]">
                {notePrompt.action === "short" ? "Shortlisted" : "Marked to discuss"}:{" "}
                <span className="text-ink font-semibold">{notePrompt.title}</span>
              </p>
              <VerdictNoteField
                action={notePrompt.action}
                note={overrides[notePrompt.id]?.note ?? null}
                autofocus
                compact
                onSave={savePromptNote}
              />
              <button
                type="button"
                onClick={() => setNotePrompt(null)}
                className="text-ink-faint hover:text-ink-dim text-[12px] underline"
              >
                Skip note
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                onClick={() => setFilter(option.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  filter === option.id
                    ? "border-ink bg-ink text-canvas"
                    : "border-line bg-surface text-ink-dim hover:border-line-bright hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="text-ink-faint py-12 text-center text-sm">
              {filter === "todo"
                ? "All caught up. Nothing left to review."
                : "Nothing matches this filter."}
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map((deal) => {
                const verdict = verdictOf(deal);
                return (
                  <DealListCard key={deal.id} deal={deal} fit={deal.fit} member={member}>
                    <div className="flex gap-1.5 pt-0.5">
                      <ActionButton
                        active={verdict?.action === "short"}
                        tone="short"
                        onClick={() => toggle(deal, "short")}
                        title="Shortlist"
                      >
                        ✓
                      </ActionButton>
                      <ActionButton
                        active={verdict?.action === "discuss"}
                        tone="discuss"
                        onClick={() => toggle(deal, "discuss")}
                      >
                        Discuss
                      </ActionButton>
                      <ActionButton
                        active={verdict?.action === "pass"}
                        tone="pass"
                        onClick={() => toggle(deal, "pass")}
                      >
                        Pass
                      </ActionButton>
                    </div>

                    {verdict?.action === "pass" && (
                      <div className="border-line border-t border-dashed pt-3">
                        <p className="text-ink-faint mb-2 text-xs font-semibold">
                          Why pass? This is what a buy box eventually gets tuned against.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {PASS_REASONS.map((reason) => (
                            <button
                              key={reason}
                              onClick={() =>
                                apply(deal, "pass", verdict.reason === reason ? null : reason)
                              }
                              className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors ${
                                verdict.reason === reason
                                  ? "border-pass bg-pass text-white"
                                  : "border-line bg-surface text-ink-dim hover:border-pass hover:bg-pass-bg hover:text-pass"
                              }`}
                            >
                              {reason}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {(verdict?.action === "short" || verdict?.action === "discuss") && (
                      <VerdictNoteField
                        action={verdict.action}
                        note={verdict.note}
                        onSave={(next) => apply(deal, verdict.action!, null, next)}
                      />
                    )}

                    <TrainAiButton deal={deal} member={member} />
                  </DealListCard>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const METER_BARS: Array<{ level: FitLevel; label: string; bar: string; text: string }> = [
  { level: "priority", label: "Priority", bar: "bg-fit-good", text: "text-fit-good" },
  { level: "fits", label: "In box", bar: "bg-fit-good/45", text: "text-fit-good/80" },
  { level: "unknown", label: "No financials", bar: "bg-line-bright", text: "text-ink-dim" },
  { level: "low", label: "Below floor", bar: "bg-fit-weak/60", text: "text-fit-weak" },
  { level: "out", label: "Out", bar: "bg-fit-out/45", text: "text-fit-out" },
];

function QueueMeter({
  counts,
  total,
  reviewed,
}: {
  counts: Record<FitLevel, number>;
  total: number;
  reviewed: number;
}) {
  const present = METER_BARS.filter((bar) => counts[bar.level] > 0);

  if (total === 0) {
    return (
      <div className="border-line bg-surface rounded-xl border px-3.5 py-3">
        <p className="text-ink-dim text-[13px]">Queue empty · {reviewed} reviewed</p>
      </div>
    );
  }

  return (
    <div className="border-line bg-surface space-y-2.5 rounded-xl border px-3.5 py-3">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {present.map((bar) => (
          <span
            key={bar.level}
            className={bar.bar}
            style={{ width: `${(counts[bar.level] / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        {present.map((bar) => (
          <span key={bar.level} className="text-[12px]">
            <b className={`tabular font-semibold ${bar.text}`}>{counts[bar.level]}</b>{" "}
            <span className="text-ink-faint">{bar.label}</span>
          </span>
        ))}
        <span className="text-ink-faint ms-auto text-[11.5px]">{reviewed} done</span>
      </div>
    </div>
  );
}

function ActionButton({
  active,
  tone,
  onClick,
  children,
  title,
}: {
  active: boolean;
  tone: "short" | "discuss" | "pass";
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  const activeTone = {
    short: "border-short bg-short text-canvas hover:brightness-110",
    discuss: "border-discuss bg-discuss text-canvas hover:brightness-110",
    pass: "border-pass bg-pass text-canvas hover:brightness-110",
  }[tone];

  const idleTone = {
    short: "border-line bg-surface-raised text-short hover:border-short hover:bg-short-bg",
    discuss:
      "border-line bg-surface-raised text-ink-dim hover:border-discuss hover:bg-discuss-bg hover:text-discuss",
    pass: "border-line bg-surface-raised text-ink-dim hover:border-pass hover:bg-pass-bg hover:text-pass",
  }[tone];

  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex-1 rounded-lg border py-2 text-[12.5px] font-semibold transition-colors ${
        active ? activeTone : idleTone
      }`}
    >
      {children}
    </button>
  );
}

function SwipeDeck({
  queue,
  total,
  member,
  onCommit,
  onSkip,
  onUndo,
  canUndo,
  onBrowse,
}: {
  queue: Scored[];
  total: number;
  member: MemberId;
  onCommit: (deal: Deal, action: VerdictAction) => void;
  onSkip: (deal: Deal) => void;
  onUndo: () => void;
  canUndo: boolean;
  onBrowse: () => void;
}) {
  const top = queue[0];
  const cardRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ startX: 0, dx: 0, active: false });
  const [flying, setFlying] = useState(false);
  const [intent, setIntent] = useState<VerdictAction | null>(null);

  const fling = useCallback(
    (deal: Deal, action: VerdictAction) => {
      const card = cardRef.current;
      const distance = action === "pass" ? -600 : action === "short" ? 600 : 0;

      if (card) {
        setFlying(true);
        card.style.transition = "transform .3s ease, opacity .3s ease";
        card.style.transform =
          action === "discuss"
            ? "translateY(-620px)"
            : `translate(${distance}px, -20px) rotate(${distance / 14}deg)`;
        card.style.opacity = "0";
      }

      setTimeout(() => {
        setFlying(false);
        setIntent(null);
        onCommit(deal, action);
      }, 190);
    },
    [onCommit],
  );

  const skipAway = useCallback(
    (deal: Deal) => {
      const card = cardRef.current;
      if (card) {
        setFlying(true);
        card.style.transition = "transform .28s ease, opacity .28s ease";
        card.style.transform = "translateY(40px) scale(0.96)";
        card.style.opacity = "0";
      }
      setTimeout(() => {
        setFlying(false);
        setIntent(null);
        onSkip(deal);
      }, 180);
    },
    [onSkip],
  );

  useEffect(() => {
    if (!top || flying) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") fling(top!, "pass");
      else if (event.key === "ArrowRight") fling(top!, "short");
      else if (event.key === "ArrowDown") fling(top!, "discuss");
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [top, flying, fling]);

  if (!top) {
    return (
      <div className="py-16 text-center">
        <p className="text-[17px] font-semibold">All caught up.</p>
        <p className="text-ink-dim mt-1.5 text-[13.5px]">Nothing left in the deck.</p>
        <button
          onClick={onBrowse}
          className="border-line bg-surface mt-4 rounded-xl border px-4 py-2.5 text-[13.5px] font-semibold"
        >
          Browse everything in List view
        </button>
      </div>
    );
  }

  function onPointerDown(event: React.PointerEvent) {
    if (flying) return;
    drag.current = { startX: event.clientX, dx: 0, active: true };
    const card = cardRef.current;
    if (card) card.style.transition = "none";
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag.current.active) return;
    drag.current.dx = event.clientX - drag.current.startX;
    const card = cardRef.current;
    if (card) {
      card.style.transform = `translateX(${drag.current.dx}px) rotate(${drag.current.dx / 18}deg)`;
    }
    setIntent(drag.current.dx > 60 ? "short" : drag.current.dx < -60 ? "pass" : null);
  }

  function onPointerUp() {
    if (!drag.current.active) return;
    const { dx } = drag.current;
    drag.current.active = false;
    setIntent(null);

    if (Math.abs(dx) > 90) {
      fling(top!, dx < 0 ? "pass" : "short");
      return;
    }

    const card = cardRef.current;
    if (card) {
      card.style.transition = "transform .22s ease";
      card.style.transform = "translateX(0) rotate(0)";
    }
  }

  return (
    <div>
      <div className="relative mb-4 h-[430px]">
        {queue
          .slice(0, 3)
          .reverse()
          .map((deal, index, arr) => {
            const depth = arr.length - 1 - index;
            const isTop = depth === 0;
            return (
              <div
                key={deal.id}
                ref={isTop ? cardRef : undefined}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? onPointerUp : undefined}
                onPointerCancel={isTop ? onPointerUp : undefined}
                className="deck-card border-line bg-surface absolute inset-0 flex flex-col overflow-hidden rounded-2xl border shadow-xl shadow-black/40"
                style={{
                  zIndex: 10 - depth,
                  transform: `translateY(${depth * 8}px) scale(${1 - depth * 0.03})`,
                }}
              >
                <FitStrip fit={deal.fit} />

                <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                  <MetricRow deal={deal} fit={deal.fit} large />

                  <div>
                    <h2 className="text-[18px] leading-snug font-semibold">{deal.title}</h2>
                    <div className="mt-1">
                      <Where deal={deal} />
                    </div>
                  </div>

                  {isTop ? (
                    <div className="text-ink-dim min-h-0 flex-1 overflow-auto text-[13.5px] leading-relaxed">
                      <BlurbText text={deal.blurb} listingUrl={deal.url} />
                    </div>
                  ) : (
                    <div className="flex-1">
                      <LeadLine deal={deal} lines={3} />
                    </div>
                  )}

                  <div className="space-y-2">
                    <VerdictChips deal={deal} member={member} />
                    <CardFooter deal={deal} />
                    <div className="border-line flex items-center justify-between gap-2 border-t pt-2.5">
                      {deal.url ? (
                        <a
                          href={deal.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-discuss text-[11.5px]"
                        >
                          Original listing →
                        </a>
                      ) : (
                        <span />
                      )}
                      <div className="flex items-center gap-3">
                        {isTop && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              skipAway(deal);
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            className="text-ink-faint hover:text-ink-dim text-[11.5px]"
                            title="Skip for now — comes back later"
                          >
                            Skip
                          </button>
                        )}
                        <TrainAiButton deal={deal} member={member} compact />
                        <Link href={`/deals/${deal.id}`} className="text-ink-faint text-[11.5px]">
                          Details
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      <div className="mb-2.5 flex items-center justify-center gap-3">
        <DeckButton
          tone="pass"
          active={intent === "pass"}
          onClick={() => fling(top, "pass")}
          title="Pass (left arrow)"
        >
          ✕
        </DeckButton>
        <DeckButton
          tone="discuss"
          small
          onClick={() => fling(top, "discuss")}
          title="Discuss (down arrow)"
        >
          ?
        </DeckButton>
        <DeckButton
          tone="short"
          active={intent === "short"}
          onClick={() => fling(top, "short")}
          title="Shortlist (right arrow)"
        >
          ✓
        </DeckButton>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => skipAway(top)}
          className="text-ink-faint hover:text-ink-dim text-[12px] underline transition-colors"
          title="Skip for now — no verdict, comes back later"
        >
          Skip deal
        </button>
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="text-ink-faint hover:text-ink-dim text-[12px] underline transition-colors disabled:opacity-40"
        >
          Undo last
        </button>
        <span className="text-ink-faint tabular text-[12px]">
          {total - queue.length + 1} of {total}
        </span>
      </div>
    </div>
  );
}

function DeckButton({
  tone,
  onClick,
  children,
  title,
  small = false,
  active = false,
}: {
  tone: "short" | "discuss" | "pass";
  onClick: () => void;
  children: React.ReactNode;
  title: string;
  small?: boolean;
  active?: boolean;
}) {
  const idle = {
    short: "border-line bg-surface text-short hover:border-short hover:bg-short-bg",
    discuss: "border-line bg-surface text-discuss hover:border-discuss hover:bg-discuss-bg",
    pass: "border-line bg-surface text-pass hover:border-pass hover:bg-pass-bg",
  }[tone];
  const lit = {
    short: "bg-short text-canvas border-short hover:brightness-110",
    discuss: "bg-discuss text-canvas border-discuss hover:brightness-110",
    pass: "bg-pass text-canvas border-pass hover:brightness-110",
  }[tone];
  const size = small ? "h-12 w-12 text-lg" : "h-14 w-14 text-2xl";
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center rounded-full border shadow-lg shadow-black/20 transition-all active:scale-95 ${size} ${
        active ? lit : idle
      }`}
    >
      {children}
    </button>
  );
}
