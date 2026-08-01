import Link from "next/link";

import {
  type Deal,
  type MemberId,
  businessModelLabel,
  earningsLabel,
  locationLabel,
  memberLabel,
  money,
  otherMember,
  sourceBucket,
} from "@/lib/model";

const BUCKET_STYLES: Record<string, string> = {
  bizbuysell: "bg-discuss-bg text-discuss",
  businessexits: "bg-short-bg text-short",
  benchmark: "bg-[#2b1c33] text-[#c08ad6]",
  axial: "bg-[#152a2c] text-[#5fb3b8]",
  newsletter: "bg-flag-bg text-flag",
};

export function SourcePill({ deal }: { deal: Deal }) {
  const label = deal.sub_source || deal.sources || "Unknown";
  const bucket = sourceBucket(deal.sub_source || deal.sources);
  return (
    <span
      className={`shrink-0 rounded-md px-2 py-1 text-[10.5px] font-bold tracking-wide ${
        BUCKET_STYLES[bucket] ?? BUCKET_STYLES.newsletter
      }`}
    >
      {label}
    </span>
  );
}

/**
 * The earnings figure, which is the number both partners scan for first.
 *
 * An asterisk means the figure is SDE rather than EBITDA — it includes owner
 * compensation, so it is not comparable to an EBITDA figure on another card. That
 * distinction is load-bearing, which is why it is shown rather than smoothed away.
 */
export function Earnings({ deal, large = false }: { deal: Deal; large?: boolean }) {
  return (
    <span className={`shrink-0 text-right font-semibold ${large ? "text-xl" : "text-[15px]"}`}>
      {earningsLabel(deal)}
      <small className="text-ink-faint mt-0.5 block text-[9.5px] font-semibold tracking-wide uppercase">
        {deal.earnings_basis ?? "no data"}
      </small>
    </span>
  );
}

export function NeedsTags({ deal }: { deal: Deal }) {
  if (deal.needs_llm.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {deal.needs_llm.map((need) => (
        <span
          key={need}
          className="bg-flag-bg text-flag rounded px-1.5 py-1 text-[11px] font-semibold"
        >
          Needs: {need}
        </span>
      ))}
    </div>
  );
}

/**
 * Both partners' calls on one deal. When they disagree the other partner's chip
 * is highlighted rather than reconciled — an unresolved disagreement is a thing
 * to talk about, not a data problem to fix.
 */
export function VerdictChips({ deal, member }: { deal: Deal; member: MemberId }) {
  const mine = deal.verdicts[member];
  const theirs = deal.verdicts[otherMember(member)];
  const myTrain = deal.trainFlags[member];
  if (!mine && !theirs && !myTrain) return null;

  const conflict = mine && theirs && mine.action !== theirs.action;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      {mine && (
        <span className="bg-surface-raised text-ink-dim rounded px-2 py-1 font-semibold">
          You: {mine.action}
          {mine.reason ? ` · ${mine.reason}` : ""}
        </span>
      )}
      {theirs && (
        <span
          className={`rounded px-2 py-1 font-semibold ${
            conflict ? "bg-flag-bg text-flag" : "bg-surface-raised text-ink-dim"
          }`}
        >
          {memberLabel(otherMember(member))}: {theirs.action}
        </span>
      )}
      {myTrain && (
        <span className="bg-flag-bg text-flag rounded px-2 py-1 font-semibold">
          Train · {myTrain.reason}
        </span>
      )}
    </div>
  );
}

export function DealSummary({ deal }: { deal: Deal }) {
  const model = businessModelLabel(deal);
  return (
    <>
      <div className="text-ink-dim text-[12.5px]">
        <span className="text-ink font-semibold">{locationLabel(deal)}</span>
        {model ? <> · {model}</> : null}
      </div>
      <div className="text-ink-dim text-[12.5px]">
        Rev {money(deal.revenue) ?? "—"} · Asking {money(deal.asking) ?? "—"}
        {deal.times_seen > 1 && (
          <> · seen {deal.times_seen}×</>
        )}
      </div>
    </>
  );
}

export function DealListCard({
  deal,
  member,
  children,
}: {
  deal: Deal;
  member: MemberId;
  children?: React.ReactNode;
}) {
  const passed = deal.verdicts[member]?.action === "pass";

  return (
    <article
      className={`border-line bg-surface rounded-xl border p-3.5 transition-opacity ${
        passed ? "opacity-45" : ""
      }`}
    >
      <div className="mb-2 flex items-start gap-2.5">
        <SourcePill deal={deal} />
        <Link
          href={`/deals/${deal.id}`}
          className="min-w-0 flex-1 text-[15px] leading-snug font-semibold hover:underline"
        >
          {deal.title}
        </Link>
        <Earnings deal={deal} />
      </div>

      <div className="space-y-1">
        <DealSummary deal={deal} />
      </div>

      {deal.needs_llm.length > 0 && (
        <div className="mt-2.5">
          <NeedsTags deal={deal} />
        </div>
      )}

      {children}

      <div className="mt-2.5">
        <VerdictChips deal={deal} member={member} />
      </div>
    </article>
  );
}
