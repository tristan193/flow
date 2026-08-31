"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { BOARD_STAGES, type Deal, type MemberId, type StageId, OUTREACH_OUTCOMES, memberLabel, stageLabel } from "@/lib/model";
import { resolvePlaybook } from "@/lib/playbooks";
import { AttachCim } from "./attach-cim";
import { Earnings, SourcePill, VerdictChips } from "./deal-card";
import { PursuitLinks } from "./pursuit-links";

const STAGE_TONE: Record<string, string> = {
  shortlist: "text-short",
  pof: "text-discuss",
  nda_to_sign: "text-discuss",
  nda: "text-discuss",
  cim: "text-flag",
  awaiting_reply: "text-discuss",
  active: "text-flag",
  closed: "text-short",
  dead: "text-ink-faint",
};

export function PipelineBoard({ deals, member }: { deals: Deal[]; member: MemberId }) {
  const router = useRouter();
  const [stages, setStages] = useState<Record<number, StageId>>({});
  const [filter, setFilter] = useState<StageId | "all">("all");
  const [error, setError] = useState<string | null>(null);

  const stageOf = useCallback(
    (deal: Deal): StageId => stages[deal.id] ?? deal.stage,
    [stages],
  );

  const move = useCallback(
    async (deal: Deal, stage: StageId) => {
      setStages((prev) => ({ ...prev, [deal.id]: stage }));
      setError(null);
      try {
        const response = await fetch("/api/stage", {
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
    return BOARD_STAGES.map((stage) => ({
      stage,
      deals: deals.filter((deal) => stageOf(deal) === stage.id),
    }));
  }, [deals, stageOf]);

  const visibleGroups = useMemo(() => {
    const nonempty = grouped.filter(({ deals: staged }) => staged.length > 0);
    if (filter === "all") return nonempty;
    return nonempty.filter(({ stage }) => stage.id === filter);
  }, [grouped, filter]);

  return (
    <div className="space-y-4">
      {error && (
        <p className="bg-pass-bg text-pass rounded-lg px-3 py-2 text-xs">{error}</p>
      )}

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
            ? "Nothing on the board yet."
            : `No deals in ${stageLabel(filter)}.`}
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
                  <div className="mb-2 flex items-start gap-2.5">
                    <SourcePill deal={deal} />
                    <Link
                      href={`/deals/${deal.id}`}
                      className="min-w-0 flex-1 text-[15px] leading-snug font-semibold hover:underline"
                    >
                      {deal.deal_number ? (
                        <span className="text-ink-faint me-1.5 tabular text-[12px] font-semibold">
                          {deal.deal_number}
                        </span>
                      ) : null}
                      {deal.title}
                    </Link>
                    <Earnings deal={deal} />
                  </div>

                  <div className="text-ink-faint mb-2.5 text-[12px]">
                    <DaysInStage deal={deal} />
                  </div>

                  <VerdictChips deal={deal} member={member} />

                  {deal.latestOutreach && (
                    <p className="text-ink-faint mt-2 text-[11.5px]">
                      {memberLabel(deal.latestOutreach.member)}:{" "}
                      {deal.latestOutreach.outcomes
                        .map((id) => OUTREACH_OUTCOMES.find((o) => o.id === id)?.label ?? id)
                        .join(" · ")}
                    </p>
                  )}

                  {(() => {
                    const playbook = resolvePlaybook(deal);
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <AttachCim dealId={deal.id} cimUrl={deal.cim_url} compact />
                        <PursuitLinks
                          ndaUrl={deal.nda_url}
                          gmailThreadUrl={deal.gmail_thread_url}
                          compact
                        />
                        {playbook && (
                          <a
                            href={playbook.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="border-line bg-surface-raised text-discuss hover:border-discuss inline-flex items-center rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors"
                          >
                            {playbook.ctaLabel}
                          </a>
                        )}
                      </div>
                    );
                  })()}

                  <label className="mt-3 block">
                    <span className="sr-only">Move {deal.title} to another stage</span>
                    <select
                      value={stageOf(deal)}
                      onChange={(event) => move(deal, event.target.value as StageId)}
                      className="border-line bg-surface-raised text-ink w-full rounded-lg border px-3 py-2 text-[13px] font-medium"
                    >
                      {BOARD_STAGES.map((option) => (
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

/**
 * How long a deal has been sitting where it is. A deal parked at NDA for two
 * months is the thing a pipeline view exists to surface.
 */
function DaysInStage({ deal }: { deal: Deal }) {
  if (!deal.stage_changed_at) return <>In {stageLabel(deal.stage).toLowerCase()}</>;

  const days = Math.floor(
    (Date.now() - new Date(deal.stage_changed_at).getTime()) / (1000 * 60 * 60 * 24),
  );

  if (days <= 0) return <>Moved here today</>;
  return (
    <>
      {days} day{days === 1 ? "" : "s"} in {stageLabel(deal.stage).toLowerCase()}
      {deal.stage_changed_by ? ` · moved by ${deal.stage_changed_by}` : ""}
    </>
  );
}
