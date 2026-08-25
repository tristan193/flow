"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

type Expectation = {
  id: number;
  deal_id: number;
  kind: string;
  due_at: string | null;
  title?: string;
  nickname?: string | null;
  stage?: string;
};

type Review = {
  id: number;
  deal_id: number | null;
  event_type: string;
  subject: string | null;
  from_address: string | null;
  status: string;
  proposed_title: string | null;
};

const KIND_LABEL: Record<string, string> = {
  nda: "waiting on NDA",
  cim: "waiting on CIM",
  broker_reply: "waiting on reply",
};

/**
 * Inbox watches + agentic review for pursuit mail that didn't hard-match.
 */
export function AttentionPanel({
  expectations,
  reviews,
}: {
  expectations: Expectation[];
  reviews: Review[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(
    async (eventId: number, action: "confirm" | "dismiss", dealId?: number) => {
      setBusyId(eventId);
      setError(null);
      try {
        const res = await fetch("/api/crm/attention", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventId, action, dealId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Resolve failed");
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Resolve failed");
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );

  if (expectations.length === 0 && reviews.length === 0) return null;

  const now = Date.now();

  return (
    <section className="border-line bg-surface space-y-3 rounded-xl border px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">
          Inbox watches
        </p>
        <p className="text-ink-faint text-[11px]">
          Armed by Act · hard-match auto · else review
        </p>
      </div>

      {expectations.length > 0 && (
        <ul className="space-y-2">
          {expectations.map((e) => {
            const overdue = e.due_at ? new Date(e.due_at).getTime() < now : false;
            return (
              <li
                key={e.id}
                className="border-line flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-2"
              >
                <div className="min-w-0">
                  <Link
                    href={`/deals/${e.deal_id}`}
                    className="text-ink hover:text-accent block truncate text-[13px] font-semibold"
                  >
                    {e.title || `Deal ${e.deal_id}`}
                  </Link>
                  <p className="text-ink-faint text-[11px]">
                    {e.nickname || "Listing"} · {KIND_LABEL[e.kind] || e.kind}
                    {overdue ? " · overdue" : ""}
                  </p>
                </div>
                <Link
                  href={`/deals/${e.deal_id}`}
                  className="text-ink-dim hover:text-ink shrink-0 text-[12px] font-semibold"
                >
                  Open →
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {reviews.length > 0 && (
        <div className="space-y-2">
          <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">
            Needs review
          </p>
          <ul className="space-y-2">
            {reviews.map((r) => (
              <li
                key={r.id}
                className="border-line space-y-2 rounded-lg border px-2.5 py-2"
              >
                <div>
                  <p className="text-ink text-[13px] font-semibold leading-snug">
                    {r.subject || "(no subject)"}
                  </p>
                  <p className="text-ink-faint text-[11px]">
                    {r.event_type.replace(/_/g, " ")} · {r.from_address || "unknown"} ·{" "}
                    {r.status}
                    {r.proposed_title ? ` · suggest: ${r.proposed_title}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.deal_id != null && (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => resolve(r.id, "confirm", r.deal_id!)}
                      className="border-discuss/40 bg-discuss-bg text-discuss rounded-lg border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50"
                    >
                      Confirm match
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => resolve(r.id, "dismiss")}
                    className="border-line bg-surface-raised text-ink-dim hover:text-ink rounded-lg border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  {r.deal_id != null && (
                    <Link
                      href={`/deals/${r.deal_id}`}
                      className="text-ink-dim hover:text-ink self-center text-[12px] font-semibold"
                    >
                      Deal →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-pass text-[12px]">{error}</p>}
    </section>
  );
}
