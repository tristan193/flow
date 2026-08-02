import Link from "next/link";

import { type Fit, type FitLevel, leadSentence, marginLabel, multipleLabel } from "@/lib/fit";
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

/**
 * Card anatomy, top to bottom — keep-reading first:
 *
 *   1. fit strip     does this clear the buy box
 *   2. metric row    earnings, multiple, margin, revenue — fixed slots
 *   3. title + lead  what the business is
 *   4. footer        source and parse quality, deliberately quiet
 */

const FIT_STYLES: Record<FitLevel, { text: string; bg: string; dot: string }> = {
  priority: { text: "text-fit-good", bg: "bg-fit-good-bg", dot: "bg-fit-good" },
  fits: { text: "text-fit-good", bg: "bg-fit-good-bg", dot: "bg-fit-good" },
  unknown: { text: "text-ink-dim", bg: "bg-surface-raised", dot: "bg-ink-faint" },
  low: { text: "text-fit-weak", bg: "bg-fit-weak-bg", dot: "bg-fit-weak" },
  out: { text: "text-fit-out", bg: "bg-fit-out-bg", dot: "bg-fit-out" },
};

export function FitStrip({ fit }: { fit: Fit }) {
  const style = FIT_STYLES[fit.level];
  return (
    <div className={`flex items-center gap-2 px-3.5 py-2 ${style.bg}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
      <span
        className={`shrink-0 text-[11px] tracking-[0.08em] uppercase ${style.text} ${
          fit.level === "priority" ? "font-bold" : "font-semibold"
        }`}
      >
        {fit.headline}
      </span>
      <span className="text-ink-faint ms-auto truncate text-right text-[11.5px]">{fit.detail}</span>
    </div>
  );
}

export function MetricRow({ deal, fit, large = false }: { deal: Deal; fit: Fit; large?: boolean }) {
  const multiple = multipleLabel(fit);
  const margin = marginLabel(fit);

  return (
    <div className="flex items-end gap-4">
      {deal.earnings == null ? (
        <div className="text-ink-faint/70 text-[10.5px] tracking-[0.05em] uppercase">
          no earnings
        </div>
      ) : (
        <div className="min-w-0">
          <div
            className={`tabular text-ink leading-none font-semibold ${
              large ? "text-[34px]" : "text-[26px]"
            }`}
          >
            {earningsLabel(deal)}
          </div>
          <div className="text-ink-faint mt-1.5 text-[10.5px] font-semibold tracking-[0.07em] uppercase">
            {deal.earnings_basis}
          </div>
        </div>
      )}

      <Metric value={multiple} label={multiple ? `on ${money(deal.asking)}` : "no price"} />
      <Metric value={margin} label="margin" />
      <Metric value={money(deal.revenue)} label="revenue" />
    </div>
  );
}

/** Missing metrics keep their slot but drop the value — no shouting dashes. */
function Metric({ value, label }: { value: string | null; label: string }) {
  return (
    <div className="min-w-0">
      {value && (
        <div className="tabular text-ink-dim text-[15px] leading-none font-semibold">{value}</div>
      )}
      <div
        className={`truncate text-[10.5px] tracking-[0.05em] uppercase ${
          value ? "text-ink-faint mt-1.5" : "text-ink-faint/55"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

export function Where({ deal }: { deal: Deal }) {
  const model = businessModelLabel(deal);
  const approximate = deal.needs_llm.includes("location");
  return (
    <span className="text-ink-dim text-[12.5px]">
      <span className="text-ink font-medium">{locationLabel(deal)}</span>
      {approximate && <span className="text-ink-faint"> (region only)</span>}
      {model ? <span className="text-ink-faint"> · {model}</span> : null}
    </span>
  );
}

export function LeadLine({ deal, lines = 2 }: { deal: Deal; lines?: 2 | 3 }) {
  const lead = leadSentence(deal.blurb);
  if (!lead) return null;
  return (
    <p className={`text-ink-dim text-[13px] leading-relaxed ${lines === 3 ? "clamp-3" : "clamp-2"}`}>
      {lead}
    </p>
  );
}

const BUCKET_STYLES: Record<string, string> = {
  bizbuysell: "text-discuss",
  businessexits: "text-short",
  benchmark: "text-[#c08ad6]",
  axial: "text-[#5fb3b8]",
  newsletter: "text-flag",
};

export function SourcePill({ deal }: { deal: Deal }) {
  const label = deal.nickname || deal.source || deal.sub_source || "Unknown";
  const bucket = sourceBucket(deal);
  return (
    <span
      className={`shrink-0 text-[11px] font-semibold tracking-wide ${
        BUCKET_STYLES[bucket] ?? BUCKET_STYLES.newsletter
      }`}
      title={[deal.sub_source, deal.source].filter(Boolean).join(" · ") || undefined}
    >
      {label}
    </span>
  );
}

/** Still used by the pipeline board, where only size matters. */
export function Earnings({ deal, large = false }: { deal: Deal; large?: boolean }) {
  return (
    <span className={`tabular shrink-0 text-right font-semibold ${large ? "text-xl" : "text-[15px]"}`}>
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
    <>
      {deal.needs_llm.map((need) => (
        <span key={need} className="text-flag text-[11px] font-medium">
          needs {need}
        </span>
      ))}
    </>
  );
}

export function VerdictChips({ deal, member }: { deal: Deal; member: MemberId }) {
  const mine = deal.verdicts[member];
  const theirs = deal.verdicts[otherMember(member)];
  const myTrain = deal.trainFlags[member];
  if (!mine && !theirs && !myTrain) return null;

  const conflict = mine && theirs && mine.action !== theirs.action;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
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

export function CardFooter({ deal }: { deal: Deal }) {
  return (
    <div className="text-ink-faint flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
      <SourcePill deal={deal} />
      {deal.times_seen > 1 && <span>seen {deal.times_seen}×</span>}
      <NeedsTags deal={deal} />
    </div>
  );
}

export function DealListCard({
  deal,
  fit,
  member,
  children,
}: {
  deal: Deal;
  fit: Fit;
  member: MemberId;
  children?: React.ReactNode;
}) {
  const decided = deal.verdicts[member] != null;

  return (
    <article
      className={`border-line bg-surface overflow-hidden rounded-xl border transition-opacity ${
        decided ? "opacity-50" : ""
      }`}
    >
      <FitStrip fit={fit} />

      <div className="space-y-2.5 p-3.5">
        <MetricRow deal={deal} fit={fit} />

        <div>
          <Link
            href={`/deals/${deal.id}`}
            className="text-[15px] leading-snug font-semibold hover:underline"
          >
            {deal.title}
          </Link>
          <div className="mt-1">
            <Where deal={deal} />
          </div>
        </div>

        <LeadLine deal={deal} />

        <CardFooter deal={deal} />

        {children}

        <VerdictChips deal={deal} member={member} />
      </div>
    </article>
  );
}
