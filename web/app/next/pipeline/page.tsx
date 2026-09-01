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
            Inbound stays in Next Review. Board: Shortlist → NDA → CIM → Pursuing.
            Closed is passed or walked — not won.
          </p>
        </div>

        {deals.length === 0 && (
          <p className="text-ink-dim mb-3 text-sm">
            Shortlist a card in Next Review. Pass from inbound lands in Closed.
          </p>
        )}

        <NextPipelineBoard deals={deals} member={member} />
      </main>
    </>
  );
}
