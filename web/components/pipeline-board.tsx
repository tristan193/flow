"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { BOARD_STAGES, type Deal, type MemberId, type StageId, stageLabel } from "@/lib/model";
import { Earnings, SourcePill, VerdictChips } from "./deal-card";

const STAGE_TONE: Record<string, string> = {
  shortlist: "text-short",
  contacted: "text-discuss",
  nda: "text-discuss",
  cim: "text-flag",
  offer: "text-flag",
  closed: "text-short",
  dead: "text-ink-faint",
};

export function PipelineBoard({ deals, member }: { deals: Deal[]; member: MemberId }) {
  const router = useRouter();
  const [stages, setStages] = useState<Record<number, StageId>>({});
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

  return (
    <div className="space-y-4">
      {error && (
        <p className="bg-pass-bg text-pass rounded-lg px-3 py-2 text-xs">{error}</p>
      )}

      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
        {grouped.map(({ stage, deals: staged }) => (
          <div
            key={stage.id}
            className="border-line bg-surface shrink-0 rounded-lg border px-3 py-2 text-center"
          >
            <b className={`block text-base leading-tight ${STAGE_TONE[stage.id] ?? ""}`}>
              {staged.length}
            </b>
            <span className="text-ink-faint text-[10.5px] tracking-wide uppercase">
              {stage.label}
            </span>
          </div>
        ))}
      </div>

      {grouped
        .filter(({ deals: staged }) => staged.length > 0)
        .map(({ stage, deals: staged }) => (
          <section key={stage.id}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className={`text-[13px] font-bold tracking-wide uppercase ${STAGE_TONE[stage.id] ?? ""}`}>
                {stage.label}
              </h2>
              <span className="text-ink-faint text-[11.5px]">{stage.hint}</span>
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
                      {deal.title}
                    </Link>
                    <Earnings deal={deal} />
                  </div>

                  <div className="text-ink-faint mb-2.5 text-[12px]">
                    <DaysInStage deal={deal} />
                  </div>

                  <VerdictChips deal={deal} member={member} />

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
        ))}
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
