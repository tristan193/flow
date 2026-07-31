"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type Deal,
  type MemberId,
  PASS_REASONS,
  type VerdictAction,
  earningsLabel,
  locationLabel,
  money,
} from "@/lib/model";
import { DealListCard, NeedsTags, SourcePill, VerdictChips } from "./deal-card";
import { TrainAiButton } from "./train-ai-button";

type Override = { action: VerdictAction | null; reason: string | null };

const FILTERS = [
  { id: "todo", label: "To review" },
  { id: "all", label: "All" },
  { id: "hasfin", label: "Has earnings" },
  { id: "needs", label: "Needs info" },
  { id: "short", label: "Shortlisted" },
  { id: "discuss", label: "To discuss" },
  { id: "train", label: "Train AI" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

export function ReviewClient({ deals, member }: { deals: Deal[]; member: MemberId }) {
  const router = useRouter();
  const [mode, setMode] = useState<"swipe" | "list">("swipe");
  const [filter, setFilter] = useState<FilterId>("todo");

  /**
   * Verdicts applied in this session, layered over what the server sent. The
   * write goes to the database immediately; this is only so the card reacts
   * without waiting for a round trip.
   */
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [history, setHistory] = useState<number[]>([]);
  const [failed, setFailed] = useState(false);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-fetching on every tap would fight the swipe animation, so server state is
  // pulled once the session goes quiet.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 2500);
  }, [router]);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const verdictOf = useCallback(
    (deal: Deal): Override | null => {
      const override = overrides[deal.id];
      if (override !== undefined) return override.action === null ? null : override;
      const stored = deal.verdicts[member];
      return stored ? { action: stored.action, reason: stored.reason } : null;
    },
    [overrides, member],
  );

  const send = useCallback(
    async (dealId: number, action: VerdictAction | null, reason: string | null) => {
      try {
        const response = await fetch("/api/verdict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId, action, reason }),
        });
        if (!response.ok) throw new Error("rejected");
        setFailed(false);
        scheduleRefresh();
      } catch {
        // The optimistic state stays put so the session is not lost; the banner
        // tells them the server did not take it.
        setFailed(true);
      }
    },
    [scheduleRefresh],
  );

  const apply = useCallback(
    (deal: Deal, action: VerdictAction | null, reason: string | null = null) => {
      setOverrides((prev) => ({ ...prev, [deal.id]: { action, reason } }));
      void send(deal.id, action, reason);
    },
    [send],
  );

  /** Tapping the current verdict again clears it, which is how a mis-tap is undone. */
  const toggle = useCallback(
    (deal: Deal, action: VerdictAction) => {
      const current = verdictOf(deal);
      if (current?.action === action) apply(deal, null);
      else apply(deal, action, action === "pass" ? (current?.reason ?? null) : null);
    },
    [apply, verdictOf],
  );

  const commitSwipe = useCallback(
    (deal: Deal, action: VerdictAction) => {
      setHistory((prev) => [...prev, deal.id]);
      apply(deal, action);
    },
    [apply],
  );

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (last == null) return;
    setHistory((prev) => prev.slice(0, -1));
    setOverrides((prev) => ({ ...prev, [last]: { action: null, reason: null } }));
    void send(last, null, null);
  }, [history, send]);

  const stats = useMemo(() => {
    let toReview = 0;
    let short = 0;
    let passed = 0;
    let needs = 0;
    for (const deal of deals) {
      const verdict = verdictOf(deal);
      if (!verdict) toReview += 1;
      else if (verdict.action === "short") short += 1;
      else if (verdict.action === "pass") passed += 1;
      if (deal.needs_llm.length > 0) needs += 1;
    }
    return { toReview, short, passed, needs };
  }, [deals, verdictOf]);

  const queue = useMemo(() => deals.filter((deal) => !verdictOf(deal)), [deals, verdictOf]);

  const visible = useMemo(() => {
    return deals.filter((deal) => {
      const verdict = verdictOf(deal);
      switch (filter) {
        case "todo":
          return !verdict;
        case "hasfin":
          return deal.ebitda != null || deal.sde != null;
        case "needs":
          return deal.needs_llm.length > 0;
        case "short":
          return verdict?.action === "short";
        case "discuss":
          return (
            verdict?.action === "discuss" ||
            deal.verdicts.tristan?.action === "discuss" ||
            deal.verdicts.partner?.action === "discuss"
          );
        case "train":
          return Boolean(deal.trainFlags[member] || deal.trainFlags.tristan || deal.trainFlags.partner);
        default:
          return true;
      }
    });
  }, [deals, filter, verdictOf]);

  return (
    <div className="space-y-3">
      <div className="border-line bg-surface flex gap-1 rounded-xl border p-1">
        {(["swipe", "list"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`flex-1 rounded-lg px-3 py-2 text-[13.5px] font-semibold capitalize transition-colors ${
              mode === value ? "bg-discuss text-white" : "text-ink-dim"
            }`}
          >
            {value === "swipe" ? "Swipe" : "List"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <Stat value={stats.toReview} label="To review" />
        <Stat value={stats.short} label="Short" />
        <Stat value={stats.passed} label="Passed" />
        <Stat value={stats.needs} label="Needs info" />
      </div>

      {failed && (
        <p className="bg-pass-bg text-pass rounded-lg px-3 py-2 text-xs">
          Could not save that to the server. Your last action is showing locally but is not stored
          yet — check your connection.
        </p>
      )}

      {mode === "swipe" ? (
        <SwipeDeck
          queue={queue}
          total={deals.length}
          member={member}
          onCommit={commitSwipe}
          onUndo={undo}
          canUndo={history.length > 0}
          onBrowse={() => setMode("list")}
        />
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
                    : "border-line bg-surface text-ink-dim"
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
                  <DealListCard key={deal.id} deal={deal} member={member}>
                    <div className="mt-3 flex gap-1.5">
                      <ActionButton
                        active={verdict?.action === "short"}
                        tone="short"
                        onClick={() => toggle(deal, "short")}
                      >
                        Shortlist
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
                      <div className="border-line mt-3 border-t border-dashed pt-3">
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
                                  : "border-line bg-surface text-ink-dim"
                              }`}
                            >
                              {reason}
                            </button>
                          ))}
                        </div>
                      </div>
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-line bg-surface rounded-lg border px-2 py-2 text-center">
      <b className="block text-lg leading-tight font-semibold">{value}</b>
      <span className="text-ink-faint text-[10.5px] tracking-wide uppercase">{label}</span>
    </div>
  );
}

function ActionButton({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "short" | "discuss" | "pass";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeTone = {
    short: "border-short bg-short text-white",
    discuss: "border-discuss bg-discuss text-white",
    pass: "border-pass bg-pass text-white",
  }[tone];

  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg border py-2.5 text-[13px] font-semibold transition-colors ${
        active ? activeTone : "border-line bg-surface text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * One card at a time, dragged left to pass or right to shortlist.
 *
 * This is the mode that makes a fifty-listing morning survivable: the decision is
 * a thumb flick, and the queue only contains deals this member has not ruled on.
 */
function SwipeDeck({
  queue,
  total,
  member,
  onCommit,
  onUndo,
  canUndo,
  onBrowse,
}: {
  queue: Deal[];
  total: number;
  member: MemberId;
  onCommit: (deal: Deal, action: VerdictAction) => void;
  onUndo: () => void;
  canUndo: boolean;
  onBrowse: () => void;
}) {
  const top = queue[0];
  const cardRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ startX: 0, dx: 0, active: false });
  const [flying, setFlying] = useState(false);

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

      // Let the card leave the screen before the queue drops it, otherwise the
      // next deal appears underneath a still-visible card.
      setTimeout(() => {
        setFlying(false);
        onCommit(deal, action);
      }, 190);
    },
    [onCommit],
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
  }

  function onPointerUp() {
    if (!drag.current.active) return;
    const { dx } = drag.current;
    drag.current.active = false;

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

  const dragProgress = 0;

  return (
    <div>
      <p className="text-ink-faint mb-2 text-center text-xs">
        {total - queue.length + 1} of {total}
      </p>

      <div className="relative mb-4 h-[460px]">
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
                className="deck-card border-line bg-surface absolute inset-0 flex flex-col rounded-2xl border p-4 shadow-xl shadow-black/30"
                style={{
                  zIndex: 10 - depth,
                  transform: `translateY(${depth * 8}px) scale(${1 - depth * 0.03})`,
                  opacity: dragProgress || 1,
                }}
              >
                <div className="mb-3 flex items-start gap-2.5">
                  <SourcePill deal={deal} />
                  <h2 className="min-w-0 flex-1 text-[19px] leading-snug font-semibold">
                    {deal.title}
                  </h2>
                  <span className="shrink-0 text-right text-xl font-semibold">
                    {earningsLabel(deal)}
                    <small className="text-ink-faint mt-0.5 block text-[9.5px] font-semibold tracking-wide uppercase">
                      {deal.earnings_basis ?? "no data"}
                    </small>
                  </span>
                </div>

                <div className="text-ink-dim space-y-1 text-[13px]">
                  <div>
                    <span className="text-ink font-semibold">{locationLabel(deal)}</span> ·{" "}
                    {deal.business_model_type.toLowerCase().replace(/_/g, " ")}
                  </div>
                  <div>
                    Rev {money(deal.revenue) ?? "—"} · Asking {money(deal.asking) ?? "—"}
                  </div>
                </div>

                <p className="text-ink-dim mt-3 flex-1 overflow-auto text-[14px] leading-relaxed">
                  {deal.blurb || "No description in the source email."}
                </p>

                <div className="mt-3 space-y-2">
                  <NeedsTags deal={deal} />
                  <VerdictChips deal={deal} member={member} />
                  <div className="flex items-center justify-between gap-2">
                    {deal.url ? (
                      <a
                        href={deal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-discuss text-xs"
                      >
                        View original listing →
                      </a>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-3">
                      <TrainAiButton deal={deal} member={member} compact />
                      <Link href={`/deals/${deal.id}`} className="text-ink-faint text-xs">
                        Details
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      <div className="mb-2 flex items-center justify-center gap-3">
        <DeckButton tone="pass" onClick={() => fling(top, "pass")} title="Pass (left arrow)">
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
        <DeckButton tone="short" onClick={() => fling(top, "short")} title="Shortlist (right arrow)">
          ♥
        </DeckButton>
      </div>

      <button
        onClick={onUndo}
        disabled={!canUndo}
        className="text-ink-faint mx-auto block text-[12.5px] underline disabled:opacity-40"
      >
        Undo last
      </button>
    </div>
  );
}

function DeckButton({
  tone,
  onClick,
  children,
  title,
  small = false,
}: {
  tone: "short" | "discuss" | "pass";
  onClick: () => void;
  children: React.ReactNode;
  title: string;
  small?: boolean;
}) {
  const color = { short: "text-short", discuss: "text-discuss", pass: "text-pass" }[tone];
  const size = small ? "h-12 w-12 text-lg" : "h-14 w-14 text-2xl";
  return (
    <button
      onClick={onClick}
      title={title}
      className={`border-line bg-surface flex items-center justify-center rounded-full border shadow-lg shadow-black/20 active:scale-95 ${size} ${color}`}
    >
      {children}
    </button>
  );
}
