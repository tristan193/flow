import { Nav } from "@/components/nav";
import { ReviewClient } from "@/components/review-client";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { listDeals } from "@/lib/deals";
import { assessFit } from "@/lib/fit";
import { memberLabel } from "@/lib/model";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await ensureReady();
  const member = await requireMember();
  const allDeals = await listDeals();
  const deals = allDeals.filter((deal) => assessFit(deal).surfaced);
  const hidden = allDeals.length - deals.length;

  return (
    <>
      <Nav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-3">
          <h1 className="text-lg font-semibold tracking-tight">Review</h1>
          <p className="text-ink-dim text-[12.5px]">
            {deals.length} listings
            {hidden > 0 ? ` · ${hidden} under floor hidden` : ""} · best fit first · verdicts are
            shared with your partner as soon as you make them
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
          Review hides deals below the visibility floors in <code>pipeline/buybox.yaml</code>:{" "}
          $350K+ earnings in the Austin / SA / Waco corridor, $750K+ elsewhere (SDE at 85%). When
          earnings are missing: $700K asking or $700K revenue in the corridor; $1.875M asking or
          $1.5M revenue elsewhere. Water filtration / purification / legionella always surfaces.
          The fit line is still a filter for attention, not a decision.
        </p>
      </main>
    </>
  );
}
