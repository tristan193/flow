import { NextNav } from "@/components/next/nav";
import { NextPipelineBoard } from "@/components/next/pipeline-board";
import { AddFromCim } from "@/components/add-from-cim";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { ensureCimFoldersForDeals } from "@/lib/next/cim-drive-sync";
import { listNextBoardDeals } from "@/lib/next/deals";
import { memberLabel } from "@/lib/next/model";

export const dynamic = "force-dynamic";

export default async function NextPipelinePage() {
  await ensureReady();
  const member = await requireMember();
  let deals = await listNextBoardDeals();
  const missingIds = deals
    .filter((deal) => (deal.stage === "shortlist" || deal.stage === "nda") && !deal.cim_url)
    .map((deal) => deal.id);
  if (missingIds.length > 0) {
    await ensureCimFoldersForDeals(missingIds);
    deals = await listNextBoardDeals();
  }

  return (
    <>
      <NextNav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Next Pipeline</h1>
            <p className="text-ink-dim text-[12.5px]">
              Progress only: Shortlisted → NDA → CIM → Pursuing → Closed. Shortlist creates
              the Drive drop folder. CIM reading lives in Review → CIM. Closed is passed
              or walked — not won.
            </p>
          </div>
          <AddFromCim createPath="/api/next/cim/create" />
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
