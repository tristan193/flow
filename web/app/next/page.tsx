import { NextNav } from "@/components/next/nav";
import { NextReviewClient } from "@/components/next/review-client";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { resolveCimDriveLinks } from "@/lib/next/cim-drive-sync";
import { listNextCimDeals, listNextInboxDeals, listNextNotesForDeals } from "@/lib/next/deals";
import { assessNextFit } from "@/lib/next/fit";
import {
  memberLabel,
  nextCimDeck,
  nextInboxDeck,
  otherMember,
  type NextNoteRow,
} from "@/lib/next/model";

export const dynamic = "force-dynamic";

export default async function NextReviewPage() {
  await ensureReady();
  const member = await requireMember();
  const inboxDeals = await listNextInboxDeals();
  const deals = inboxDeals.filter((deal) => assessNextFit(deal).surfaced);
  const hidden = inboxDeals.length - deals.length;
  const demoCount = deals.filter((d) => d.is_demo).length;
  const myDeck = nextInboxDeck(deals, member);

  let cimDeals = await listNextCimDeals();
  const missing = cimDeals.filter((deal) => !deal.cim_url).map((deal) => deal.deal_number);
  if (missing.length > 0) {
    await resolveCimDriveLinks(missing);
    cimDeals = await listNextCimDeals();
  }
  const notesMap = await listNextNotesForDeals(cimDeals.map((deal) => deal.id));
  const notesByDealId: Record<number, NextNoteRow[]> = Object.fromEntries(notesMap);
  const myCim = nextCimDeck(cimDeals, member);

  return (
    <>
      <NextNav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-3">
          <h1 className="text-lg font-semibold tracking-tight">Next Review</h1>
          <p className="text-ink-dim text-[12.5px]">
            New · {myDeck.length} in your deck
            {deals.length !== myDeck.length ? ` · ${deals.length} still inbound` : ""}
            {hidden > 0 ? ` · ${hidden} under floor hidden` : ""}
            {demoCount > 0 ? ` · ${demoCount} DEMO` : ""}
            {" · "}
            CIM · {myCim.length} to review
            {cimDeals.length !== myCim.length ? ` · ${cimDeals.length} at CIM` : ""}
            {" · "}a Pass on New stays in {memberLabel(otherMember(member))}&apos;s deck
          </p>
        </div>

        <NextReviewClient
          deals={deals}
          cimDeals={cimDeals}
          notesByDealId={notesByDealId}
          member={member}
        />

        <p className="text-ink-faint mt-6 text-[11.5px] leading-relaxed">
          New is inbound teasers. CIM is packs at CIM — Drive folder plus Simon&apos;s written
          review. Pipeline only shows progress. Super Like stays on the far right of New.
        </p>
      </main>
    </>
  );
}
