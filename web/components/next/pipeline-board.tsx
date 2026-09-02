"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { byPinnedThenEarnings } from "@/lib/next/fit";
import {
  coerceNextStage,
  mapNextStage,
  NEXT_BOARD_STAGES,
  type MemberId,
  type NextDeal,
  type NextStageId,
  memberLabel,
  nextStageLabel,
} from "@/lib/next/model";
import { gmailAllHref } from "@/lib/next/identity";
import { NextAttachCim } from "./attach-cim";
import { DealTitleStack, Earnings, SourcePill, SuperLikeMark, VerdictChips } from "./deal-card";

const STAGE_TONE: Record<string, string> = {
  shortlist: "text-short",
  nda: "text-discuss",
  cim: "text-flag",
  pursuing: "text-discuss",
  closed: "text-ink-faint",
};

export function NextPipelineBoard({ deals, member }: { deals: NextDeal[]; member: MemberId }) {
  const router = useRouter();
  const [stages, setStages] = useState<Record<number, NextStageId>>({});
  const [filter, setFilter] = useState<NextStageId | "all">("all");
  const [error, setError] = useState<string | null>(null);

  const stageOf = useCallback(
    (deal: NextDeal): NextStageId => coerceNextStage(stages[deal.id] ?? deal.stage),
    [stages],
  );

  const move = useCallback(
    async (deal: NextDeal, stage: NextStageId) => {
      setStages((prev) => ({ ...prev, [deal.id]: stage }));
      setError(null);
      try {
        const response = await fetch("/api/next/stage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId: deal.id, stage }),
        });
        if (!response.ok) throw new Error("rejected");
        router.refresh();
      } catch {
        setStages((prev) => ({ ...prev, [deal.id]: deal.stage }));
        setError("Could not move that deal. Check your connection and try again.");
      }
    },
    [router],
  );

  const grouped = useMemo(() => {
    return NEXT_BOARD_STAGES.map((stage) => ({
      stage,
      deals: deals.filter((deal) => stageOf(deal) === stage.id).sort(byPinnedThenEarnings),
    }));
  }, [deals, stageOf]);

  const visibleGroups = useMemo(() => {
    const nonempty = grouped.filter(({ deals: staged }) => staged.length > 0);
    if (filter === "all") return nonempty;
    return nonempty.filter(({ stage }) => stage.id === filter);
  }, [grouped, filter]);

  return (
    <div className="space-y-4">
      {error && <p className="bg-pass-bg text-pass rounded-lg px-3 py-2 text-xs">{error}</p>}

      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`shrink-0 rounded-lg border px-3 py-2 text-center transition-colors ${
            filter === "all"
              ? "border-ink bg-ink text-canvas"
              : "border-line bg-surface text-ink-dim hover:border-line-bright"
          }`}
        >
          <b className="block text-base leading-tight">{deals.length}</b>
          <span className="text-[10.5px] tracking-wide uppercase opacity-80">All</span>
        </button>
        {grouped.map(({ stage, deals: staged }) => {
          const active = filter === stage.id;
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => setFilter(active ? "all" : stage.id)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-center transition-colors ${
                active
                  ? "border-ink bg-ink text-canvas"
                  : "border-line bg-surface hover:border-line-bright"
              }`}
            >
              <b
                className={`block text-base leading-tight ${
                  active ? "text-canvas" : STAGE_TONE[stage.id] ?? "text-ink"
                }`}
              >
                {staged.length}
              </b>
              <span
                className={`text-[10.5px] tracking-wide uppercase ${
                  active ? "text-canvas/80" : "text-ink-faint"
                }`}
              >
                {stage.label}
              </span>
            </button>
          );
        })}
      </div>

      {visibleGroups.length === 0 ? (
        <p className="text-ink-faint py-10 text-center text-sm">
          {filter === "all"
            ? "Nothing on the board yet. Shortlist a card in Next Review."
            : `No deals in ${nextStageLabel(filter)}.`}
        </p>
      ) : (
        visibleGroups.map(({ stage, deals: staged }) => (
          <section key={stage.id} id={`stage-${stage.id}`}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2
                className={`text-[13px] font-bold tracking-wide uppercase ${STAGE_TONE[stage.id] ?? ""}`}
              >
                {stage.label}
              </h2>
              <span className="text-ink-faint text-[11.5px]">{stage.hint}</span>
              <span className="text-ink-faint ms-auto text-[11.5px]">{staged.length}</span>
            </div>

            <div className="space-y-2">
              {staged.map((deal) => (
                <article key={deal.id} className="border-line bg-surface rounded-xl border p-3.5">
                  <div className="mb-2 flex w-full min-w-0 items-start gap-2.5">
                    <div className="min-w-0 flex-1">
                      <DealTitleStack
                        deal={deal}
                        href={`/next/deals/${deal.id}`}
                        titleClassName="text-[15px] leading-snug font-semibold hover:underline"
                      />
                    </div>
                    <Earnings deal={deal} />
                  </div>
                  <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <SuperLikeMark deal={deal} />
                    <SourcePill deal={deal} />
                  </div>

                  <div className="text-ink-faint mb-2.5 space-y-1 text-[12px]">
                    <DaysInStage deal={deal} />
                    {deal.next_action && (
                      <p>
                        Next: <span className="text-ink-dim">{deal.next_action}</span>
                      </p>
                    )}
                    {deal.alias_names.length > 0 && (
                      <p className="truncate">
                        Aliases: {deal.alias_names.slice(0, 3).join(" · ")}
                      </p>
                    )}
                    {deal.gmail_thread_ids.length > 0 && (
                      <p className="flex flex-wrap gap-x-2">
                        {deal.gmail_thread_ids.map((id) => (
                          <a
                            key={id}
                            href={gmailAllHref(id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-discuss"
                          >
                            Gmail thread
                          </a>
                        ))}
                      </p>
                    )}
                  </div>

                  <VerdictChips deal={deal} member={member} />

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <NextAttachCim dealId={deal.id} cimUrl={deal.cim_url} compact />
                    {deal.nda_url && (
                      <a
                        href={deal.nda_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border-line bg-surface-raised text-discuss inline-flex items-center rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold"
                      >
                        NDA
                      </a>
                    )}
                  </div>

                  <label className="mt-3 block">
                    <span className="sr-only">Move {deal.title} to another stage</span>
                    <select
                      value={stageOf(deal)}
                      onChange={(event) => {
                        const next = mapNextStage(event.target.value);
                        if (next) void move(deal, next);
                      }}
                      className="border-line bg-surface-raised text-ink w-full rounded-lg border px-3 py-2 text-[13px] font-medium"
                    >
                      {NEXT_BOARD_STAGES.map((option) => (
                        <option key={option.id} value={option.id}>
                          Move to: {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function DaysInStage({ deal }: { deal: NextDeal }) {
  if (!deal.stage_changed_at) return <>In {nextStageLabel(deal.stage).toLowerCase()}</>;

  const days = Math.floor(
    (Date.now() - new Date(deal.stage_changed_at).getTime()) / (1000 * 60 * 60 * 24),
  );

  if (days <= 0) return <>Moved here today</>;
  return (
    <>
      {days} day{days === 1 ? "" : "s"} in {nextStageLabel(deal.stage).toLowerCase()}
      {deal.stage_changed_by ? ` · moved by ${memberLabel(deal.stage_changed_by)}` : ""}
    </>
  );
}
