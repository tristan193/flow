import Link from "next/link";

import { ResolveReview } from "@/components/db/resolve-review";
import { NextNav } from "@/components/next/nav";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { query } from "@/lib/db";
import {
  listDealLog,
  type DealLogKind,
  type DealLogRow,
  type DealLogStatus,
} from "@/lib/next/change-log";
import { listNextDeals, nextDealPublicPath } from "@/lib/next/deals";
import { memberLabel, money, nextStageLabel, type NextDeal } from "@/lib/next/model";

export const dynamic = "force-dynamic";

/**
 * The database, visible. Two tables: deals (current state) and deal_log
 * (who / what / why / when). Fed by agents through the log; never held up by
 * them — rejected and needs-review submissions park here instead of breaking
 * the boards.
 */

const ACTOR_FILTERS = ["tristan", "partner", "dirk", "simon", "pipeline"] as const;
const KIND_FILTERS: DealLogKind[] = [
  "create",
  "update",
  "stage",
  "verdict",
  "cim_verdict",
  "note",
  "super_like",
  "merge",
  "import",
  "watch",
];
const STATUS_FILTERS: DealLogStatus[] = ["applied", "needs_review", "rejected", "dismissed"];

function actorName(actor: string | null): string {
  if (!actor) return "—";
  if (actor === "tristan" || actor === "partner") return memberLabel(actor).split(/\s+/)[0];
  return actor.charAt(0).toUpperCase() + actor.slice(1);
}

function shortValue(value: unknown): string {
  if (value == null || value === "") return "∅";
  if (typeof value === "number") return money(value) ?? String(value);
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > 48 ? `${s.slice(0, 45)}…` : s;
}

function patchSummary(row: DealLogRow): string {
  const parts: string[] = [];
  for (const [field, change] of Object.entries(row.patch)) {
    if (!change || typeof change !== "object") continue;
    const hasOld = "old" in change && change.old != null && change.old !== "";
    if (hasOld) parts.push(`${field}: ${shortValue(change.old)} → ${shortValue(change.new)}`);
    else parts.push(`${field}: ${shortValue(change.new)}`);
    if (parts.length >= 4) break;
  }
  return parts.join(" · ");
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function filterHref(
  current: Record<string, string | undefined>,
  key: string,
  value: string | null,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v && k !== key) params.set(k, v);
  }
  if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `/db?${qs}` : "/db";
}

function FilterPills({
  label,
  values,
  active,
  current,
  paramKey,
}: {
  label: string;
  values: readonly string[];
  active: string | undefined;
  current: Record<string, string | undefined>;
  paramKey: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-ink-faint w-12 text-[11px] font-bold tracking-wide uppercase">
        {label}
      </span>
      {values.map((value) => {
        const on = active === value;
        return (
          <Link
            key={value}
            href={filterHref(current, paramKey, on ? null : value)}
            className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${
              on
                ? "border-flag/50 bg-flag-bg text-flag"
                : "border-line bg-surface-raised text-ink-dim hover:text-ink"
            }`}
          >
            {paramKey === "actor" ? actorName(value) : value.replace("_", " ")}
          </Link>
        );
      })}
    </div>
  );
}

function voteGlyph(action: string | null | undefined): string {
  if (action === "short") return "✓";
  if (action === "pass") return "✗";
  if (action === "discuss") return "?";
  return "·";
}

function DealsTable({ deals }: { deals: NextDeal[] }) {
  return (
    <div className="border-line overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[720px] text-[12.5px]">
        <thead>
          <tr className="border-line text-ink-faint border-b text-left text-[11px] font-bold tracking-wide uppercase">
            <th className="px-3 py-2">TLY</th>
            <th className="px-3 py-2">Deal</th>
            <th className="px-3 py-2">Stage</th>
            <th className="px-3 py-2 text-center">T / J</th>
            <th className="px-3 py-2 text-right">Revenue</th>
            <th className="px-3 py-2 text-right">EBITDA</th>
            <th className="px-3 py-2 text-right">Asking</th>
            <th className="px-3 py-2">CIM</th>
            <th className="px-3 py-2">Last touched</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => {
            const href = nextDealPublicPath(deal.deal_number) ?? `/next/deals/${deal.id}`;
            const isCim = deal.stage === "cim";
            const tristan = isCim
              ? deal.cim_verdicts.tristan?.action
              : deal.verdicts.tristan?.action;
            const jim = isCim ? deal.cim_verdicts.partner?.action : deal.verdicts.partner?.action;
            return (
              <tr key={deal.id} className="border-line/60 border-b last:border-b-0">
                <td className="px-3 py-1.5 font-semibold whitespace-nowrap">
                  <Link href={href} className="text-flag hover:underline">
                    {deal.deal_number}
                  </Link>
                </td>
                <td className="max-w-[260px] truncate px-3 py-1.5" title={deal.cim_name ?? deal.title}>
                  {deal.cim_name ?? deal.title}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">{nextStageLabel(deal.stage)}</td>
                <td className="px-3 py-1.5 text-center whitespace-nowrap">
                  {voteGlyph(tristan)} / {voteGlyph(jim)}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {money(deal.revenue) ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {money(deal.ebitda) ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {money(deal.asking) ?? "—"}
                </td>
                <td className="px-3 py-1.5">{deal.cim_url ? "yes" : "—"}</td>
                <td className="text-ink-dim px-3 py-1.5 whitespace-nowrap">
                  {when(deal.last_seen)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function DbPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await ensureReady();
  const member = await requireMember();

  const raw = await searchParams;
  const filters: Record<string, string | undefined> = {
    actor: typeof raw.actor === "string" ? raw.actor : undefined,
    kind: typeof raw.kind === "string" ? raw.kind : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
  };

  const [deals, log, reviews, agents] = await Promise.all([
    listNextDeals(),
    listDealLog({
      actor: filters.actor ?? null,
      kind: (filters.kind as DealLogKind | undefined) ?? null,
      status: (filters.status as DealLogStatus | undefined) ?? null,
      limit: 120,
    }),
    listDealLog({ status: "needs_review", limit: 50 }),
    query<{ actor: string; last: string; entries: string }>(
      `SELECT actor, MAX(created_at)::text AS last, COUNT(*)::text AS entries
         FROM deal_log
        WHERE actor NOT IN ('tristan', 'partner')
        GROUP BY actor
        ORDER BY MAX(created_at) DESC`,
    ),
  ]);

  const byStage = new Map<string, number>();
  for (const deal of deals) byStage.set(deal.stage, (byStage.get(deal.stage) ?? 0) + 1);

  return (
    <>
      <NextNav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Database</h1>
          <p className="text-ink-dim text-[12.5px]">
            One row per deal; every change in the log with who, what, and why. Agents feed it —
            their misfires park below instead of touching the boards.
          </p>
        </div>

        <section className="flex flex-wrap gap-2">
          {["inbox", "shortlist", "nda", "cim", "pursuing", "closed"].map((stage) => (
            <div key={stage} className="border-line bg-surface rounded-xl border px-3 py-2">
              <p className="text-base font-semibold">{byStage.get(stage) ?? 0}</p>
              <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">
                {nextStageLabel(stage)}
              </p>
            </div>
          ))}
          <div className="border-line bg-surface rounded-xl border px-3 py-2">
            <p className="text-base font-semibold">{deals.length}</p>
            <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">Deals</p>
          </div>
        </section>

        {reviews.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[13px] font-semibold tracking-tight">
              Needs review · agent proposals
            </h2>
            <div className="space-y-1.5">
              {reviews.map((row) => (
                <div
                  key={row.id}
                  className="border-discuss/40 bg-surface flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px]"
                >
                  <span className="font-semibold">{actorName(row.actor)}</span>
                  {row.on_behalf_of && (
                    <span className="text-ink-dim">for {actorName(row.on_behalf_of)}</span>
                  )}
                  <span className="text-ink-dim">{row.kind.replace("_", " ")}</span>
                  {row.deal_number && (
                    <Link
                      href={nextDealPublicPath(row.deal_number) ?? "/db"}
                      className="text-flag font-semibold hover:underline"
                    >
                      {row.deal_number}
                    </Link>
                  )}
                  <span className="min-w-0 flex-1 truncate">{patchSummary(row)}</span>
                  {row.reason && <span className="text-ink-dim truncate">· {row.reason}</span>}
                  <span className="text-ink-faint whitespace-nowrap">{when(row.created_at)}</span>
                  <ResolveReview logId={row.id} />
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold tracking-tight">
            Agents · last seen in the log
          </h2>
          <div className="flex flex-wrap gap-2">
            {agents.map((agent) => (
              <div key={agent.actor} className="border-line bg-surface rounded-xl border px-3 py-2">
                <p className="text-[13px] font-semibold">{actorName(agent.actor)}</p>
                <p className="text-ink-dim text-[11.5px]">
                  {when(new Date(agent.last).toISOString())} · {agent.entries} entries
                </p>
              </div>
            ))}
            {agents.length === 0 && (
              <p className="text-ink-dim text-[12.5px]">No machine writes logged yet.</p>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold tracking-tight">Deals · current state</h2>
          <DealsTable deals={deals} />
        </section>

        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold tracking-tight">Activity · deal_log</h2>
          <div className="space-y-1.5">
            <FilterPills
              label="Who"
              values={ACTOR_FILTERS}
              active={filters.actor}
              current={filters}
              paramKey="actor"
            />
            <FilterPills
              label="What"
              values={KIND_FILTERS}
              active={filters.kind}
              current={filters}
              paramKey="kind"
            />
            <FilterPills
              label="Status"
              values={STATUS_FILTERS}
              active={filters.status}
              current={filters}
              paramKey="status"
            />
          </div>
          <div className="border-line overflow-hidden rounded-xl border">
            {log.map((row) => (
              <div
                key={row.id}
                className="border-line/60 flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[12.5px] last:border-b-0"
              >
                <span className="text-ink-faint w-24 whitespace-nowrap">{when(row.created_at)}</span>
                <span className="w-16 font-semibold">{actorName(row.actor)}</span>
                {row.on_behalf_of && (
                  <span className="text-ink-dim">for {actorName(row.on_behalf_of)}</span>
                )}
                <span className="text-ink-dim w-20">{row.kind.replace("_", " ")}</span>
                {row.deal_number ? (
                  <Link
                    href={nextDealPublicPath(row.deal_number) ?? "/db"}
                    className="text-flag w-16 font-semibold hover:underline"
                  >
                    {row.deal_number}
                  </Link>
                ) : (
                  <span className="text-ink-faint w-16">—</span>
                )}
                <span className="min-w-0 flex-1 truncate" title={patchSummary(row)}>
                  {patchSummary(row) || row.reason || "—"}
                </span>
                {row.status !== "applied" && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase ${
                      row.status === "rejected"
                        ? "bg-pass-bg text-pass"
                        : "bg-discuss-bg text-discuss"
                    }`}
                  >
                    {row.status.replace("_", " ")}
                  </span>
                )}
              </div>
            ))}
            {log.length === 0 && (
              <p className="text-ink-dim px-3 py-3 text-[12.5px]">
                Nothing in the log for this filter yet.
              </p>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
