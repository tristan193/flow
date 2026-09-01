import { NextNav } from "@/components/next/nav";
import { NextReviewClient } from "@/components/next/review-client";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { listNextDeals } from "@/lib/next/deals";
import { assessNextFit } from "@/lib/next/fit";
import { memberLabel } from "@/lib/next/model";

export const dynamic = "force-dynamic";

export default async function NextReviewPage() {
  await ensureReady();
  const member = await requireMember();
  const allDeals = await listNextDeals();
  const deals = allDeals.filter((deal) => assessNextFit(deal).surfaced);
  const hidden = allDeals.length - deals.length;
  const demoCount = deals.filter((d) => d.is_demo).length;

  return (
    <>
      <NextNav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-3">
          <h1 className="text-lg font-semibold tracking-tight">Next Review</h1>
          <p className="text-ink-dim text-[12.5px]">
            Experimental · {deals.length} listings
            {hidden > 0 ? ` · ${hidden} under floor hidden` : ""}
            {demoCount > 0 ? ` · ${demoCount} DEMO` : ""} · shortlist moves onto the Next board
          </p>
        </div>

        {deals.length === 0 ? (
          <div className="border-line bg-surface rounded-xl border p-4 text-sm">
            <p className="font-medium">No Next deals yet</p>
            <p className="text-ink-dim mt-1.5 leading-relaxed">
              Dirk posts to <code>POST /api/next/import</code>. The live harvest still feeds{" "}
              <code>/</code> via <code>/api/import</code>.
            </p>
          </div>
        ) : (
          <NextReviewClient deals={deals} member={member} />
        )}

        <p className="text-ink-faint mt-6 text-[11.5px] leading-relaxed">
          Same visibility floors as the original: $350K+ in the Austin / SA / Waco corridor, $750K+
          elsewhere. Water always surfaces. This queue writes to <code>deals_next</code> only.
        </p>
      </main>
    </>
  );
}
