import Link from "next/link";
import { notFound } from "next/navigation";

import { BlurbText } from "@/components/blurb-text";
import { ListingLink } from "@/components/listing-link";
import { NextAttachCim } from "@/components/next/attach-cim";
import { NextBuyboxReview } from "@/components/next/buybox-review";
import { NextDealActions } from "@/components/next/deal-actions";
import { DealTitleStack, NeedsTags, RemintBadge, SourcePill, VerdictChips } from "@/components/next/deal-card";
import { listingIdLabel, sourceDisplayName } from "@/lib/next/display";
import { NextNav } from "@/components/next/nav";
import { CimPartnerNotes } from "@/components/next/notes";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { gmailAllHref } from "@/lib/next/identity";
import { listDealLog } from "@/lib/next/change-log";
import { getNextDealByRouteParam, listNextNotes } from "@/lib/next/deals";
import { assessNextFit } from "@/lib/next/fit";
import {
  businessModelLabel,
  defaultNextAction,
  earningsLabel,
  isCimStageForNotes,
  locationLabel,
  memberLabel,
  money,
  nextStageLabel,
  partnerNotesOnly,
} from "@/lib/next/model";

export const dynamic = "force-dynamic";

export default async function NextDealPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureReady();
  const member = await requireMember();

  const { id } = await params;
  const deal = await getNextDealByRouteParam(id);
  if (!deal) notFound();

  const [notes, history] = await Promise.all([
    listNextNotes(deal.id),
    listDealLog({ dealId: deal.id, status: "applied", limit: 40 }),
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
    ...(deal.duplicate_of ? [["Duplicate of", deal.duplicate_of] as [string, string]] : []),
    ...(deal.ingest_disposition
      ? [["Ingest", deal.ingest_disposition] as [string, string]]
      : []),
  ];

  return (
    <>
      <NextNav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <Link href="/next" className="text-ink-faint text-xs">
          ← Back to Next review
        </Link>

        <div className="mt-3 mb-4 flex w-full min-w-0 flex-col">
          <DealTitleStack
            deal={deal}
            titleAs="h1"
            titleClassName="text-xl leading-snug font-semibold tracking-tight"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <SourcePill deal={deal} />
            <RemintBadge deal={deal} />
            {deal.is_demo && (
              <span className="bg-flag-bg text-flag rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase">
                DEMO
              </span>
            )}
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
            <ListingLink
              href={deal.url}
              className="border-line bg-surface text-discuss block rounded-xl border px-3.5 py-3 text-[13.5px]"
            >
              View original listing →
            </ListingLink>
          )}

          {isCimStageForNotes(deal) ? (
            <CimPartnerNotes
              dealId={deal.id}
              deal={deal}
              notes={partnerNotesOnly(notes)}
              member={member}
            />
          ) : null}

          {history.length > 0 && (
            <section>
              <h2 className="text-ink-faint mb-1.5 text-[11.5px] font-bold tracking-wide uppercase">
                History
              </h2>
              <ol className="border-line bg-surface divide-line divide-y rounded-xl border">
                {history.map((row) => {
                  const fields = Object.entries(row.patch)
                    .slice(0, 3)
                    .map(([field, change]) => {
                      if (!change || typeof change !== "object") return field;
                      const from = "old" in change && change.old != null ? String(change.old) : null;
                      const to = "new" in change ? String(change.new ?? "∅") : "";
                      return from ? `${field}: ${from} → ${to}` : `${field}: ${to}`;
                    })
                    .join(" · ");
                  return (
                    <li
                      key={row.id}
                      className="text-ink-dim flex items-baseline justify-between gap-3 px-3.5 py-2 text-[12.5px]"
                    >
                      <span className="min-w-0">
                        <span className="text-ink font-medium">{memberLabel(row.actor)}</span>
                        {row.on_behalf_of ? ` for ${memberLabel(row.on_behalf_of)}` : ""}
                        {" · "}
                        {row.kind.replace("_", " ")}
                        {fields ? ` · ${fields}` : ""}
                        {row.reason ? ` · ${row.reason}` : ""}
                      </span>
                      <span className="text-ink-faint shrink-0">
                        {new Date(row.created_at).toLocaleDateString()}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="text-ink-faint mt-1.5 text-[11.5px]">
                Full trail on{" "}
                <Link href="/db" className="text-flag hover:underline">
                  Database
                </Link>
                .
              </p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
