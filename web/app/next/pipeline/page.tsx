import { NextNav } from "@/components/next/nav";
import { NextPipelineBoard } from "@/components/next/pipeline-board";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { listNextBoardDeals } from "@/lib/next/deals";
import { memberLabel } from "@/lib/next/model";

export const dynamic = "force-dynamic";

export default async function NextPipelinePage() {
  await ensureReady();
  const member = await requireMember();
  const deals = await listNextBoardDeals();

  return (
    <>
      <NextNav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-3">
          <h1 className="text-lg font-semibold tracking-tight">Next Pipeline</h1>
          <p className="text-ink-dim text-[12.5px]">
            Shortlisted deals hold stage: Inbound → Shortlisted → POF → NDA → CIM → reply → active
          </p>
        </div>

        {deals.length === 0 ? (
          <div className="border-line bg-surface rounded-xl border p-4 text-sm">
            <p className="font-medium">Nothing on the Next board yet</p>
            <p className="text-ink-dim mt-1.5 leading-relaxed">
              Shortlist a card in Next Review. Pass from inbound lands in Pass/dead.
            </p>
          </div>
        ) : (
          <NextPipelineBoard deals={deals} member={member} />
        )}
      </main>
    </>
  );
}
