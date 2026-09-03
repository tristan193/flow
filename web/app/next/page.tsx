import { NextNav } from "@/components/next/nav";
import { NextReviewClient } from "@/components/next/review-client";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { listNextInboxDeals } from "@/lib/next/deals";
import { assessNextFit } from "@/lib/next/fit";
import { memberLabel, nextInboxDeck, otherMember } from "@/lib/next/model";

export const dynamic = "force-dynamic";

export default async function NextReviewPage() {
  await ensureReady();
  const member = await requireMember();
  const inboxDeals = await listNextInboxDeals();
  const deals = inboxDeals.filter((deal) => assessNextFit(deal).surfaced);
  const hidden = inboxDeals.length - deals.length;
  const demoCount = deals.filter((d) => d.is_demo).length;
  const myDeck = nextInboxDeck(deals, member);

  return (
    <>
      <NextNav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-3">
          <h1 className="text-lg font-semibold tracking-tight">Next Review</h1>
          <p className="text-ink-dim text-[12.5px]">
            Your deck · {myDeck.length} left
            {deals.length !== myDeck.length ? ` · ${deals.length} still inbound` : ""}
            {hidden > 0 ? ` · ${hidden} under floor hidden` : ""}
            {demoCount > 0 ? ` · ${demoCount} DEMO` : ""} · a Pass here stays in{" "}
            {memberLabel(otherMember(member))}&apos;s deck
          </p>
        </div>

        {deals.length === 0 ? (
          <div className="border-line bg-surface rounded-xl border p-4 text-sm">
            <p className="font-medium">Nothing inbound</p>
            <p className="text-ink-dim mt-1.5 leading-relaxed">
              Nothing inbound. Board cards (CIM / Pursuing / Closed) stay on Pipeline. Dirk posts
              teasers to <code>POST /api/next/import</code>.
            </p>
          </div>
        ) : (
          <NextReviewClient deals={deals} member={member} />
        )}

        <p className="text-ink-faint mt-6 text-[11.5px] leading-relaxed">
          Same visibility floors as the original: $350K+ in the Austin / SA / Waco corridor, $750K+
          elsewhere. Water always surfaces. Inbound only — CIM, Pursuing, and Closed stay on the board.
        </p>
      </main>
    </>
  );
}
