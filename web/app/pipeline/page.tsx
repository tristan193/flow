import { Nav } from "@/components/nav";
import { PipelineBoard } from "@/components/pipeline-board";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { listBoardDeals } from "@/lib/deals";
import { memberLabel } from "@/lib/model";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  await ensureReady();
  const member = await requireMember();
  const deals = await listBoardDeals();

  return (
    <>
      <Nav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-3">
          <h1 className="text-lg font-semibold tracking-tight">Pipeline</h1>
          <p className="text-ink-dim text-[12.5px]">
            Everything either of you shortlisted, and how far it has got
          </p>
        </div>

        {deals.length === 0 ? (
          <div className="border-line bg-surface rounded-xl border p-4 text-sm">
            <p className="font-medium">Nothing in the pipeline yet</p>
            <p className="text-ink-dim mt-1.5 leading-relaxed">
              Shortlisting a deal in Review puts it here automatically.
            </p>
          </div>
        ) : (
          <PipelineBoard deals={deals} member={member} />
        )}
      </main>
    </>
  );
}
