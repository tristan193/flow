/**
 * UI sketch — not wired to anything.
 *
 * A static mockup of an alternative Review screen, with made-up deals, so the
 * layout can be argued about before any of it touches the real components.
 * Nothing here imports from lib/ or components/; delete the folder and the app
 * is unchanged.
 */

export const dynamic = "force-static";

type Level = "priority" | "fits" | "unknown" | "low" | "out";

interface Sketch {
  fit: Level;
  fitNote: string;
  earnings: string;
  basis: string;
  multiple: string | null;
  askNote: string;
  margin: string | null;
  revenue: string | null;
  title: string;
  where: string;
  lead: string;
  source: string;
  meta: string;
}

const DEALS: Sketch[] = [
  {
    fit: "priority",
    fitNote: "Central Texas · clears T1",
    earnings: "$1.4M",
    basis: "EBITDA",
    multiple: "3.9×",
    askNote: "on $5.5M",
    margin: "22%",
    revenue: "$6.4M",
    title: "Commercial Plumbing & Backflow Contractor",
    where: "Round Rock, TX",
    lead: "Thirty-year commercial plumbing contractor with a dedicated backflow testing division serving school districts and municipal facilities across the Austin metro.",
    source: "Axial",
    meta: "seen 2× · recurring revenue",
  },
  {
    fit: "fits",
    fitNote: "TOLA · clears T2",
    earnings: "$880K",
    basis: "EBITDA",
    multiple: "4.5×",
    askNote: "on $3.9M",
    margin: "18%",
    revenue: "$4.9M",
    title: "Industrial Filtration Media Distributor",
    where: "Tulsa, OK",
    lead: "Distributor of cartridge and membrane filter media to refineries and food processors, operating on annual supply agreements.",
    source: "BizBuySell",
    meta: "seen 1×",
  },
  {
    fit: "unknown",
    fitNote: "National · nothing disclosed",
    earnings: null as unknown as string,
    basis: "",
    multiple: null,
    askNote: "no price",
    margin: null,
    revenue: null,
    title: "Route-Based Facilities Services Business",
    where: "Phoenix, AZ",
    lead: "Recurring janitorial and facilities route serving medical office buildings. Financials available after NDA.",
    source: "BizBuySell",
    meta: "seen 1× · needs earnings",
  },
  {
    fit: "low",
    fitNote: "National · needs T2",
    earnings: "$430K",
    basis: "SDE",
    multiple: "5.8×",
    askNote: "on $2.5M",
    margin: "11%",
    revenue: "$3.9M",
    title: "Screen Printing Business with 15-Year Management Team",
    where: "Charlotte, NC",
    lead: "Apparel decoration shop with a long-tenured management team and a concentrated base of corporate accounts.",
    source: "BizBuySell",
    meta: "seen 3×",
  },
  {
    fit: "out",
    fitNote: "Excluded category · restaurant",
    earnings: null as unknown as string,
    basis: "",
    multiple: null,
    askNote: "no price",
    margin: null,
    revenue: null,
    title: "Award-Winning Italian Restaurant — Real Estate Available",
    where: "Denver, CO",
    lead: "Full-service Italian restaurant, real estate offered separately.",
    source: "BizBuySell",
    meta: "seen 1×",
  },
];

const FIT: Record<Level, { label: string; text: string; bg: string; dot: string }> = {
  priority: { label: "Priority", text: "text-[#3ecf8e]", bg: "bg-[#10291f]", dot: "bg-[#3ecf8e]" },
  fits: { label: "In the box", text: "text-[#3ecf8e]", bg: "bg-[#10291f]", dot: "bg-[#3ecf8e]" },
  unknown: { label: "No financials", text: "text-[#99a2ad]", bg: "bg-[#1c2128]", dot: "bg-[#646c77]" },
  low: { label: "Below floor", text: "text-[#e0a63c]", bg: "bg-[#2a2214]", dot: "bg-[#e0a63c]" },
  out: { label: "Out of box", text: "text-[#b8564d]", bg: "bg-[#2a1715]", dot: "bg-[#b8564d]" },
};

export default function DesignSketch() {
  return (
    <main className="min-h-screen bg-[#0b0d10] px-4 py-6 text-[#f2f4f7]">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-5">
          <p className="text-[11px] tracking-[0.14em] text-[#646c77] uppercase">UI sketch</p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Review — alternative layout</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#99a2ad]">
            Dummy data. The idea: answer &ldquo;keep reading?&rdquo; before anything else, then the
            three numbers that qualify it, then what the business is. Everything else gets dim.
          </p>
        </header>

        <QueueMeter />

        <section className="mt-3 space-y-2">
          {DEALS.map((deal) => (
            <Card key={deal.title} deal={deal} />
          ))}
        </section>

        <Deck />

        <p className="mt-8 text-[11.5px] leading-relaxed text-[#646c77]">
          Sketch only — nothing on this page is connected to the database or the verdict API.
        </p>
      </div>
    </main>
  );
}

function QueueMeter() {
  const bars = [
    { w: 6, c: "bg-[#3ecf8e]" },
    { w: 10, c: "bg-[#3ecf8e]/45" },
    { w: 54, c: "bg-[#39414c]" },
    { w: 12, c: "bg-[#e0a63c]/60" },
    { w: 18, c: "bg-[#b8564d]/45" },
  ];
  const counts = [
    { n: 5, label: "Priority", c: "text-[#3ecf8e]" },
    { n: 9, label: "In box", c: "text-[#3ecf8e]/80" },
    { n: 48, label: "No financials", c: "text-[#99a2ad]" },
    { n: 11, label: "Below floor", c: "text-[#e0a63c]" },
    { n: 16, label: "Out", c: "text-[#b8564d]" },
  ];

  return (
    <div className="space-y-2.5 rounded-xl border border-[#262c35] bg-[#14171c] px-3.5 py-3">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {bars.map((bar, i) => (
          <span key={i} className={bar.c} style={{ width: `${bar.w}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        {counts.map((c) => (
          <span key={c.label} className="text-[12px]">
            <b className={`font-semibold ${c.c}`}>{c.n}</b>{" "}
            <span className="text-[#646c77]">{c.label}</span>
          </span>
        ))}
        <span className="ms-auto text-[11.5px] text-[#646c77]">0 done</span>
      </div>
    </div>
  );
}

function Card({ deal }: { deal: Sketch }) {
  const fit = FIT[deal.fit];

  return (
    <article className="overflow-hidden rounded-xl border border-[#262c35] bg-[#14171c]">
      {/* 1. The answer, same position on every card. */}
      <div className={`flex items-center gap-2 px-3.5 py-2 ${fit.bg}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${fit.dot}`} />
        <span
          className={`shrink-0 text-[11px] tracking-[0.08em] uppercase ${fit.text} ${
            deal.fit === "priority" ? "font-bold" : "font-semibold"
          }`}
        >
          {fit.label}
        </span>
        <span className="ms-auto truncate text-right text-[11.5px] text-[#646c77]">
          {deal.fitNote}
        </span>
      </div>

      <div className="space-y-2.5 p-3.5">
        {/* 2. Fixed metric slots so a list reads as columns. */}
        <div className="flex items-end gap-4">
          {deal.earnings ? (
            <div>
              <div className="text-[26px] leading-none font-semibold tabular-nums">
                {deal.earnings}
                {deal.basis === "SDE" && <span className="text-[#646c77]">*</span>}
              </div>
              <div className="mt-1.5 text-[10.5px] font-semibold tracking-[0.07em] text-[#646c77] uppercase">
                {deal.basis}
              </div>
            </div>
          ) : (
            <Slot value={null} label="no earnings" />
          )}
          <Slot value={deal.multiple} label={deal.askNote} />
          <Slot value={deal.margin} label="margin" />
          <Slot value={deal.revenue} label="revenue" />
        </div>

        {/* 3. What it is. */}
        <div>
          <h2 className="text-[15px] leading-snug font-semibold">{deal.title}</h2>
          <p className="mt-1 text-[12.5px] text-[#99a2ad]">{deal.where}</p>
        </div>
        <p className="line-clamp-2 text-[13px] leading-relaxed text-[#99a2ad]">{deal.lead}</p>

        {/* 4. Provenance, quietest row on the card. */}
        <div className="flex flex-wrap items-center gap-x-2.5 text-[11px] text-[#646c77]">
          <span className="font-semibold text-[#7aa2f7]">{deal.source}</span>
          <span>{deal.meta}</span>
        </div>

        <div className="flex gap-1.5 pt-0.5">
          <Btn>Shortlist</Btn>
          <Btn>Discuss</Btn>
          <Btn>Pass</Btn>
        </div>
      </div>
    </article>
  );
}

function Slot({ value, label }: { value: string | null; label: string }) {
  return (
    <div className="min-w-0">
      {value && (
        <div className="text-[15px] leading-none font-semibold text-[#99a2ad] tabular-nums">
          {value}
        </div>
      )}
      <div
        className={`truncate text-[10.5px] tracking-[0.05em] uppercase ${
          value ? "mt-1.5 text-[#646c77]" : "text-[#646c77]/55"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

function Btn({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex-1 rounded-lg border border-[#262c35] bg-[#1c2128] py-2 text-center text-[12.5px] font-semibold text-[#99a2ad]">
      {children}
    </span>
  );
}

/** The same card as a single swipe card, for comparison. */
function Deck() {
  const deal = DEALS[0];
  const fit = FIT[deal.fit];

  return (
    <section className="mt-8">
      <p className="mb-2 text-[11px] tracking-[0.14em] text-[#646c77] uppercase">
        Same card, swipe mode
      </p>
      <div className="overflow-hidden rounded-2xl border border-[#262c35] bg-[#14171c] shadow-xl shadow-black/40">
        <div className={`flex items-center gap-2 px-4 py-2.5 ${fit.bg}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${fit.dot}`} />
          <span className={`text-[11px] font-bold tracking-[0.08em] uppercase ${fit.text}`}>
            {fit.label}
          </span>
          <span className="ms-auto text-[11.5px] text-[#646c77]">{deal.fitNote}</span>
        </div>
        <div className="flex h-[330px] flex-col gap-3 p-4">
          <div className="flex items-end gap-5">
            <div>
              <div className="text-[34px] leading-none font-semibold tabular-nums">
                {deal.earnings}
              </div>
              <div className="mt-1.5 text-[10.5px] font-semibold tracking-[0.07em] text-[#646c77] uppercase">
                {deal.basis}
              </div>
            </div>
            <Slot value={deal.multiple} label={deal.askNote} />
            <Slot value={deal.margin} label="margin" />
            <Slot value={deal.revenue} label="revenue" />
          </div>
          <div>
            <h2 className="text-[18px] leading-snug font-semibold">{deal.title}</h2>
            <p className="mt-1 text-[12.5px] text-[#99a2ad]">{deal.where}</p>
          </div>
          <p className="flex-1 text-[13.5px] leading-relaxed text-[#99a2ad]">{deal.lead}</p>
          <div className="flex items-center justify-between border-t border-[#262c35] pt-2.5 text-[11.5px]">
            <span className="text-[#7aa2f7]">Original listing →</span>
            <span className="text-[#646c77]">Train AI · Details</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        <Circle className="text-[#f0645a]">✕</Circle>
        <Circle small className="text-[#7aa2f7]">
          ?
        </Circle>
        <Circle className="text-[#3ecf8e]">♥</Circle>
      </div>
    </section>
  );
}

function Circle({
  children,
  className,
  small = false,
}: {
  children: React.ReactNode;
  className: string;
  small?: boolean;
}) {
  return (
    <span
      className={`flex items-center justify-center rounded-full border border-[#262c35] bg-[#14171c] shadow-lg shadow-black/20 ${
        small ? "h-12 w-12 text-lg" : "h-14 w-14 text-2xl"
      } ${className}`}
    >
      {children}
    </span>
  );
}
