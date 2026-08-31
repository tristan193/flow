import { Nav } from "@/components/nav";
import { PipelineClient } from "@/components/pipeline-client";
import { AddFromCim } from "@/components/add-from-cim";
import { AttentionPanel } from "@/components/attention-panel";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { listCrmAttention } from "@/lib/crm-pursuit";
import { listBoardDeals } from "@/lib/deals";
import { memberLabel } from "@/lib/model";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  await ensureReady();
  const member = await requireMember();
  const [deals, attention] = await Promise.all([listBoardDeals(), listCrmAttention()]);

  return (
    <>
      <Nav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Pipeline</h1>
            <p className="text-ink-dim text-[12.5px]">
              Shortlist a card and it lands here. Board holds state through NDA / CIM / reply.
            </p>
          </div>
          <AddFromCim />
        </div>

        <div className="mb-3">
          <AttentionPanel
            expectations={attention.expectations}
            reviews={attention.reviews}
          />
        </div>

        {deals.length === 0 ? (
          <div className="border-line bg-surface rounded-xl border p-4 text-sm">
            <p className="font-medium">Nothing in the pipeline yet</p>
            <p className="text-ink-dim mt-1.5 leading-relaxed">
              Shortlist a deal in Review, or upload a CIM to add one here directly.
            </p>
          </div>
        ) : (
          <PipelineClient deals={deals} member={member} />
        )}
      </main>
    </>
  );
}
