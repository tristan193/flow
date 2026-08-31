import Link from "next/link";
import { notFound } from "next/navigation";

import { BlurbText } from "@/components/blurb-text";
import { AttachCim } from "@/components/attach-cim";
import { BuyboxReview } from "@/components/buybox-review";
import { DealActions } from "@/components/deal-actions";
import { NeedsTags, SourcePill, VerdictChips } from "@/components/deal-card";
import { Nav } from "@/components/nav";
import { NoteThread } from "@/components/note-thread";
import { PursuitLinks } from "@/components/pursuit-links";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { getDeal, listNotes, listStageEvents } from "@/lib/deals";
import { gmailAllHref } from "@/lib/identity";
import {
  businessModelLabel,
  defaultNextAction,
  earningsLabel,
  locationLabel,
  memberLabel,
  money,
  OUTREACH_OUTCOMES,
  stageLabel,
} from "@/lib/model";
import { resolvePlaybook } from "@/lib/playbooks";

export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureReady();
  const member = await requireMember();

  const { id } = await params;
  const dealId = Number(id);
  if (!Number.isInteger(dealId)) notFound();

  const deal = await getDeal(dealId);
  if (!deal) notFound();

  const [notes, events] = await Promise.all([listNotes(dealId), listStageEvents(dealId)]);

  const model = businessModelLabel(deal);
  const nextAction = deal.next_action || defaultNextAction(deal.stage);
  const facts: [string, string][] = [
    ["Deal number", deal.deal_number || "—"],
    ["Earnings", `${earningsLabel(deal)} ${deal.earnings_basis ? `(${deal.earnings_basis})` : ""}`],
    ["Revenue", money(deal.revenue) ?? "Not disclosed"],
    ["Asking", money(deal.asking) ?? "Not disclosed"],
    ["Margin", deal.margin != null ? `${(deal.margin * 100).toFixed(1)}%` : "—"],
    ["Location", locationLabel(deal)],
    ...(model ? [["Business model", model] as [string, string]] : []),
    ["Broker firm", deal.broker_firm || "—"],
    ["Source", deal.nickname || deal.source || "Unknown"],
    ["Sender", deal.sub_source || "—"],
    ["Domain", deal.source || "—"],
    ["Source IDs", deal.source_ids.map((s) => s.canonical).join(", ") || deal.source_deal_id || "—"],
    ["Times seen", String(deal.times_seen)],
    ["First seen", new Date(deal.first_seen).toLocaleDateString()],
    ["Stage", stageLabel(deal.stage)],
    ["Next action", nextAction || "—"],
  ];

  return (
    <>
      <Nav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <Link href="/" className="text-ink-faint text-xs">
          ← Back to review
        </Link>

        <div className="mt-3 mb-4 flex items-start gap-2.5">
          <SourcePill deal={deal} />
          <h1 className="min-w-0 flex-1 text-xl leading-snug font-semibold tracking-tight">
            {deal.deal_number ? (
              <span className="text-ink-faint me-2 tabular text-[14px] font-semibold">
                {deal.deal_number}
              </span>
            ) : null}
            {deal.title}
          </h1>
        </div>

        <div className="space-y-4">
          <NeedsTags deal={deal} />
          <VerdictChips deal={deal} member={member} />

          <DealActions deal={deal} member={member} />

          <AttachCim dealId={deal.id} cimUrl={deal.cim_url} />

          {deal.cim_url ? <BuyboxReview deal={deal} /> : null}

          {deal.alias_names.length > 0 && (
            <section className="border-line bg-surface rounded-xl border px-3.5 py-3">
              <p className="text-ink-faint mb-1.5 text-[11px] font-bold tracking-wide uppercase">
                Aliases
              </p>
              <ul className="text-ink-dim space-y-1 text-[13px]">
                {deal.alias_names.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </section>
          )}

          {deal.gmail_thread_ids.length > 0 && (
            <section className="border-line bg-surface rounded-xl border px-3.5 py-3">
              <p className="text-ink-faint mb-1.5 text-[11px] font-bold tracking-wide uppercase">
                Gmail threads
              </p>
              <ul className="space-y-1.5">
                {deal.gmail_thread_ids.map((tid) => (
                  <li key={tid}>
                    <a
                      href={gmailAllHref(tid)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-discuss text-[13px] break-all"
                    >
                      {gmailAllHref(tid)}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <PursuitLinks ndaUrl={deal.nda_url} gmailThreadUrl={deal.gmail_thread_url} />

          {(() => {
            const playbook = resolvePlaybook(deal);
            if (!playbook && !deal.latestOutreach) return null;
            return (
              <section className="border-line bg-surface space-y-2 rounded-xl border px-3.5 py-3">
                <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">
                  Next move
                </p>
                {playbook && (
                  <>
                    <a
                      href={playbook.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-discuss text-canvas block rounded-lg px-3.5 py-3 text-center text-[14px] font-bold"
                    >
                      {playbook.ctaLabel}
                    </a>
                    <p className="text-ink-faint text-[12px]">{playbook.hint}</p>
                  </>
                )}
                {deal.latestOutreach && (
                  <p className="text-ink-faint text-[12px]">
                    Last debrief:{" "}
                    {deal.latestOutreach.outcomes
                      .map((id) => OUTREACH_OUTCOMES.find((o) => o.id === id)?.label ?? id)
                      .join(" · ")}
                  </p>
                )}
              </section>
            );
          })()}

          <section className="border-line bg-surface rounded-xl border">
            <dl className="divide-line divide-y">
              {facts.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between px-3.5 py-2.5">
                  <dt className="text-ink-dim text-[12.5px]">{label}</dt>
                  <dd className="text-[13.5px] font-medium capitalize">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {deal.blurb && (
            <section>
              <h2 className="text-ink-faint mb-1.5 text-[11.5px] font-bold tracking-wide uppercase">
                From the source email
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

          <NoteThread dealId={deal.id} notes={notes} />

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
                      {event.from_stage ? `${stageLabel(event.from_stage)} → ` : ""}
                      <span className="text-ink font-medium">{stageLabel(event.to_stage)}</span>
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
