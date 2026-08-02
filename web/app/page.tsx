import { Nav } from "@/components/nav";
import { ReviewClient } from "@/components/review-client";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { listDeals } from "@/lib/deals";
import { memberLabel } from "@/lib/model";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await ensureReady();
  const member = await requireMember();
  const deals = await listDeals();

  return (
    <>
      <Nav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-3">
          <h1 className="text-lg font-semibold tracking-tight">Review</h1>
          <p className="text-ink-dim text-[12.5px]">
            {deals.length} listings · best fit first · verdicts are shared with your partner as soon
            as you make them
          </p>
        </div>

        {deals.length === 0 ? (
          <div className="border-line bg-surface rounded-xl border p-4 text-sm">
            <p className="font-medium">No deals yet</p>
            <p className="text-ink-dim mt-1.5 leading-relaxed">
              Import a snapshot from the Data tab to get started.
            </p>
          </div>
        ) : (
          <ReviewClient deals={deals} member={member} />
        )}

        <p className="text-ink-faint mt-6 text-[11.5px] leading-relaxed">
          The fit line reads the buy box in <code>pipeline/buybox.yaml</code> — geography tier,
          financial floor, excluded and strategic categories. It is a filter for attention, not a
          decision. An asterisk on an earnings figure means it is SDE, not EBITDA: it includes owner
          compensation, so the floor is compared against 85% of it. Deals flagged &ldquo;needs
          info&rdquo; have gaps the parser refused to guess at rather than errors.
        </p>
      </main>
    </>
  );
}
