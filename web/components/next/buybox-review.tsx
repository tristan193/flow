import { assessNextFit, type Fit } from "@/lib/next/fit";
import { buyboxReviewFacts } from "@/lib/next/buybox-status";
import type { NextDealRow } from "@/lib/next/model";
import { earningsLabel, money } from "@/lib/next/model";

/** CIM / deal scored against documented buy box — no invented dislikes. */
export function NextBuyboxReview({ deal, fit }: { deal: NextDealRow; fit?: Fit }) {
  const assessed = fit ?? assessNextFit(deal);
  const facts = buyboxReviewFacts();

  return (
    <section className="border-line bg-surface space-y-2.5 rounded-xl border px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">
          Buy-box review
        </p>
        <span className="text-flag text-[10.5px] font-semibold tracking-wide uppercase">
          {facts.status}
        </span>
      </div>

      <p className="text-ink-dim text-[12.5px] leading-snug">{facts.note}</p>
      <p className="text-ink-faint text-[12px] leading-snug">
        Floors from <code>pipeline/buybox.yaml</code>: $350k Austin/SA/Waco corridor, $750k
        elsewhere. Water / filtration / legionella always surfaces.
      </p>

      <dl className="divide-line divide-y text-[13px]">
        <Row label="Fit" value={`${assessed.headline} · ${assessed.detail}`} />
        <Row
          label="Earnings"
          value={`${earningsLabel(deal)}${deal.earnings_basis ? ` (${deal.earnings_basis})` : ""}`}
        />
        <Row label="Revenue" value={money(deal.revenue) ?? "Not in CIM / teaser"} />
        <Row label="Asking" value={money(deal.asking) ?? "Not disclosed"} />
        <Row
          label="Documented exclusions"
          value={assessed.disqualifier ?? "None of the yaml exclusion categories hit"}
        />
        <Row
          label="Learned dislikes"
          value={
            facts.learnedDislikes.length
              ? facts.learnedDislikes.map((d) => d.pattern).join(", ")
              : "None recorded — not invented"
          }
        />
        <Row
          label="Hard-nos"
          value={
            facts.learnedHardNos.length
              ? facts.learnedHardNos.join(", ")
              : "None recorded — not invented"
          }
        />
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-ink-dim shrink-0 text-[12px]">{label}</dt>
      <dd className="text-right text-[12.5px] font-medium">{value}</dd>
    </div>
  );
}
