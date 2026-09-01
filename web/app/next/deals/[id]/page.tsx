import Link from "next/link";
import { notFound } from "next/navigation";

import { BlurbText } from "@/components/blurb-text";
import { NextAttachCim } from "@/components/next/attach-cim";
import { NextBuyboxReview } from "@/components/next/buybox-review";
import { NextDealActions } from "@/components/next/deal-actions";
import { DealIdLine, NeedsTags, SourcePill, VerdictChips } from "@/components/next/deal-card";
import { listingIdLabel, sourceDisplayName } from "@/lib/next/display";
import { NextNav } from "@/components/next/nav";
import { NextNotes } from "@/components/next/notes";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { gmailAllHref } from "@/lib/next/identity";
import { getNextDeal, listNextNotes, listNextStageEvents } from "@/lib/next/deals";
import { assessNextFit } from "@/lib/next/fit";
import {
  businessModelLabel,
  defaultNextAction,
  earningsLabel,
  locationLabel,
  memberLabel,
  money,
  nextStageLabel,
} from "@/lib/next/model";

export const dynamic = "force-dynamic";

export default async function NextDealPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureReady();
  const member = await requireMember();

  const { id } = await params;
  const dealId = Number(id);
  if (!Number.isInteger(dealId)) notFound();

  const deal = await getNextDeal(dealId);
  if (!deal) notFound();

  const [notes, events] = await Promise.all([
    listNextNotes(dealId),
    listNextStageEvents(dealId),
  ]);

  const fit = assessNextFit(deal);
  const model = businessModelLabel(deal);

  const facts: [string, string][] = [
    ["Deal number", deal.deal_number],
    ["Earnings", `${earningsLabel(deal)} ${deal.earnings_basis ? `(${deal.earnings_basis})` : ""}`],
    ["Revenue", money(deal.revenue) ?? "Not disclosed"],
    ["Asking", money(deal.asking) ?? "Not disclosed"],
    ["Margin", deal.margin != null ? `${(deal.margin * 100).toFixed(1)}%` : "—"],
    ["Location", locationLabel(deal)],
    ...(model ? [["Business model", model] as [string, string]] : []),
    ["Broker", deal.broker_firm || "—"],
    ["Source IDs", listingIdLabel(deal) || "—"],
    ["Source", sourceDisplayName(deal)],
    ["Stage", nextStageLabel(deal.stage)],
    ["Next action", deal.next_action || defaultNextAction(deal.stage) || "—"],
  ];

  return (
    <>
      <NextNav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <Link href="/next" className="text-ink-faint text-xs">
          ← Back to Next review
        </Link>

        <div className="mt-3 mb-4 flex items-start gap-2.5">
          <SourcePill deal={deal} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl leading-snug font-semibold tracking-tight">{deal.title}</h1>
            <div className="flex flex-wrap items-center gap-x-2">
              <DealIdLine deal={deal} />
              {deal.is_demo && (
                <span className="bg-flag-bg text-flag rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase">
                  DEMO
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <NeedsTags deal={deal} />
          <VerdictChips deal={deal} member={member} />

          <NextDealActions deal={deal} member={member} />

          <NextAttachCim dealId={deal.id} cimUrl={deal.cim_url} />

          <NextBuyboxReview deal={deal} fit={fit} />

          {deal.alias_names.length > 0 && (
            <section className="border-line bg-surface rounded-xl border px-3.5 py-3">
              <p className="text-ink-faint mb-1.5 text-[11px] font-bold tracking-wide uppercase">
                Aliases
              </p>
              <p className="text-ink-dim text-[13px]">{deal.alias_names.join(" · ")}</p>
            </section>
          )}

          {deal.gmail_thread_ids.length > 0 && (
            <section className="border-line bg-surface space-y-1.5 rounded-xl border px-3.5 py-3">
              <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">
                Gmail threads
              </p>
              {deal.gmail_thread_ids.map((threadId) => (
                <a
                  key={threadId}
                  href={gmailAllHref(threadId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-discuss block text-[13px]"
                >
                  {gmailAllHref(threadId)}
                </a>
              ))}
            </section>
          )}

          {deal.nda_url && (
            <a
              href={deal.nda_url}
              target="_blank"
              rel="noopener noreferrer"
              className="border-line bg-surface text-discuss block rounded-xl border px-3.5 py-3 text-[13.5px]"
            >
              Open NDA →
            </a>
          )}

          <section className="border-line bg-surface rounded-xl border">
            <dl className="divide-line divide-y">
              {facts.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between px-3.5 py-2.5">
                  <dt className="text-ink-dim text-[12.5px]">{label}</dt>
                  <dd className="text-right text-[13.5px] font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {deal.blurb && (
            <section>
              <h2 className="text-ink-faint mb-1.5 text-[11.5px] font-bold tracking-wide uppercase">
                From the source
              </h2>
              <p className="border-line bg-surface text-ink-dim rounded-xl border p-3.5 text-[13.5px] leading-relaxed">
                <BlurbText text={deal.blurb} listingUrl={deal.url} empty="" />
              </p>
            </section>
          )}

          {deal.url && (
            <a
              href={deal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="border-line bg-surface text-discuss block rounded-xl border px-3.5 py-3 text-[13.5px]"
            >
              View original listing →
            </a>
          )}

          <NextNotes dealId={deal.id} notes={notes} />

          {events.length > 0 && (
            <section>
              <h2 className="text-ink-faint mb-1.5 text-[11.5px] font-bold tracking-wide uppercase">
                Stage history
              </h2>
              <ol className="border-line bg-surface divide-line divide-y rounded-xl border">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="text-ink-dim flex items-baseline justify-between px-3.5 py-2 text-[12.5px]"
                  >
                    <span>
                      {event.from_stage ? `${nextStageLabel(event.from_stage)} → ` : ""}
                      <span className="text-ink font-medium">{nextStageLabel(event.to_stage)}</span>
                      {" · "}
                      {memberLabel(event.member)}
                    </span>
                    <span className="text-ink-faint">
                      {new Date(event.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
