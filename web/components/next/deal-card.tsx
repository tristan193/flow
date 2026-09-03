import Link from "next/link";

import { cimPackPath } from "@/lib/cim-pack-id";
import { type Fit, type FitLevel, leadSentence, marginLabel, multipleLabel } from "@/lib/fit";
import { dealIdLines, sourceDisplayName } from "@/lib/next/display";
import {
  CIM_VERDICT_LABELS,
  VERDICT_LABELS,
  type MemberId,
  type NextDeal,
  type VerdictAction,
  businessModelLabel,
  cimPackMetricSlots,
  earningsLabel,
  locationLabel,
  memberLabel,
  money,
  otherMember,
  sourceBucket,
} from "@/lib/next/model";

/**
 * Copied card anatomy (not a shared refactor of the live Review card):
 *   1. fit strip
 *   2. metric row
 *   3. title + lead
 *   4. footer
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

export function MetricRow({ deal, fit, large = false }: { deal: NextDeal; fit: Fit; large?: boolean }) {
  const multiple = multipleLabel(fit);
  const margin = marginLabel(fit);
  const asking = money(deal.asking);

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

      {multiple ? (
        <Metric value={multiple} label={asking ? `on ${asking}` : "multiple"} />
      ) : (
        <Metric value={asking} label="asking" />
      )}
      <Metric value={margin} label="margin" />
      <Metric value={money(deal.revenue)} label="revenue" />
    </div>
  );
}

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

export function Where({ deal }: { deal: NextDeal }) {
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

export function LeadLine({ deal, lines = 2 }: { deal: NextDeal; lines?: 2 | 3 }) {
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

export function SourcePill({ deal }: { deal: NextDeal }) {
  const label = sourceDisplayName(deal);
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

/** Quiet TLY then listing ids, each on its own full-width line under the title. */
export function DealIdStack({ deal }: { deal: NextDeal }) {
  const lines = dealIdLines(deal);
  if (lines.length === 0) return null;
  return (
    <div className="mt-0.5 flex w-full min-w-0 flex-col">
      {lines.map((line) => (
        <div key={line} className="text-ink-faint block w-full text-[11px] font-medium tabular">
          {line}
        </div>
      ))}
    </div>
  );
}

/**
 * Title on its own full-width line, IDs stacked underneath. flex-col so a parent
 * flex-row cannot pull hex/TLY to the left of the company name.
 */
export function DealTitleStack({
  deal,
  href,
  titleAs: Tag = "span",
  titleClassName,
}: {
  deal: NextDeal;
  href?: string;
  titleAs?: "h1" | "h2" | "span";
  titleClassName: string;
}) {
  const inner = (
    <>
      <Tag className={`block w-full min-w-0 ${titleClassName}`}>{deal.title}</Tag>
      <DealIdStack deal={deal} />
    </>
  );
  const stackClass = "flex w-full min-w-0 flex-col";
  if (href) {
    return (
      <Link href={href} className={stackClass}>
        {inner}
      </Link>
    );
  }
  return <div className={stackClass}>{inner}</div>;
}

export function Earnings({ deal, large = false }: { deal: NextDeal; large?: boolean }) {
  return (
    <span className={`tabular shrink-0 text-right font-semibold ${large ? "text-xl" : "text-[15px]"}`}>
      {earningsLabel(deal)}
      <small className="text-ink-faint mt-0.5 block text-[9.5px] font-semibold tracking-wide uppercase">
        {deal.earnings_basis ?? "no data"}
      </small>
    </span>
  );
}

export function NeedsTags({ deal }: { deal: NextDeal }) {
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

export function VerdictChips({
  deal,
  member,
  lane,
}: {
  deal: NextDeal;
  member: MemberId;
  lane?: "review" | "cim";
}) {
  const cim = lane === "cim" || deal.stage === "cim";
  const votes = cim ? (deal.cim_verdicts ?? {}) : deal.verdicts;
  const labels = cim ? CIM_VERDICT_LABELS : VERDICT_LABELS;
  const mine = votes[member];
  const theirs = votes[otherMember(member)];
  if (!mine && !theirs) return null;

  const conflict = mine && theirs && mine.action !== theirs.action;
  const labelOf = (action: VerdictAction) => labels[action] ?? action;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {mine && (
        <span className="bg-surface-raised text-ink-dim rounded px-2 py-1 font-semibold">
          You: {labelOf(mine.action)}
          {mine.reason ? ` · ${mine.reason}` : ""}
          {mine.note ? ` · “${mine.note.length > 40 ? `${mine.note.slice(0, 40)}…` : mine.note}”` : ""}
        </span>
      )}
      {theirs && (
        <span
          className={`rounded px-2 py-1 font-semibold ${
            conflict ? "bg-flag-bg text-flag" : "bg-surface-raised text-ink-dim"
          }`}
        >
          {memberLabel(otherMember(member))}: {labelOf(theirs.action)}
          {theirs.note
            ? ` · “${theirs.note.length > 40 ? `${theirs.note.slice(0, 40)}…` : theirs.note}”`
            : ""}
        </span>
      )}
    </div>
  );
}

/** Opens `/cim/TLY-XXX` in a new tab so the swipe deck keeps its place. */
export function CimPackLink({
  dealNumber,
  className = "text-discuss hover:text-discuss/80 text-[11.5px] font-medium transition-colors",
  children = "CIM",
}: {
  dealNumber?: string | null;
  className?: string;
  children?: React.ReactNode;
}) {
  const href = cimPackPath(dealNumber);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </a>
  );
}

export function SuperLikeMark({ deal }: { deal: NextDeal }) {
  if (!deal.super_liked_at) return null;
  return (
    <span className="text-short font-semibold" title="Super Liked — stays at the top of this stack">
      ✓✓✓
    </span>
  );
}

/** CIM Review badge. New mode keeps ✓✓✓; CIM shows a star only. */
export function SuperLikeStar({ deal }: { deal: NextDeal }) {
  if (!deal.super_liked_at) return null;
  return (
    <span className="text-short text-[18px] leading-none" title="Super Liked">
      ★
    </span>
  );
}

/** Pack numbers only. Missing fields are omitted — no empty labels, no "No financials". */
export function CimPackMetrics({ deal }: { deal: NextDeal }) {
  const slots = cimPackMetricSlots(deal);
  if (slots.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-4">
      {slots.map((slot) => (
        <div key={slot.label} className="min-w-0">
          <div className="tabular text-ink-dim text-[15px] leading-none font-semibold">{slot.value}</div>
          <div className="text-ink-faint mt-1.5 truncate text-[10.5px] tracking-[0.05em] uppercase">
            {slot.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardFooter({ deal }: { deal: NextDeal }) {
  return (
    <div className="text-ink-faint flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
      {deal.is_demo && <span className="text-flag font-semibold">DEMO</span>}
      <SuperLikeMark deal={deal} />
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
  deal: NextDeal;
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

        <DealTitleStack
          deal={deal}
          href={`/next/deals/${deal.id}`}
          titleClassName="text-[15px] leading-snug font-semibold hover:underline"
        />
        <div className="mt-1">
          <Where deal={deal} />
        </div>

        <LeadLine deal={deal} />

        <CardFooter deal={deal} />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {deal.url ? (
            <a
              href={deal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-discuss hover:text-discuss/80 text-[11.5px] font-medium transition-colors"
            >
              Original listing →
            </a>
          ) : null}
          <CimPackLink dealNumber={deal.deal_number} />
        </div>

        {children}

        <VerdictChips deal={deal} member={member} />
      </div>
    </article>
  );
}
