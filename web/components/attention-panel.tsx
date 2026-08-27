"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { dirkMailHref } from "@/lib/gmail-thread";

type Expectation = {
  id: number;
  deal_id: number;
  kind: string;
  due_at: string | null;
  title?: string;
  nickname?: string | null;
  stage?: string;
  gmail_thread_url?: string | null;
  nda_url?: string | null;
};

type Review = {
  id: number;
  deal_id: number | null;
  event_type: string;
  subject: string | null;
  from_address: string | null;
  status: string;
  proposed_title: string | null;
  gmail_thread_url?: string | null;
  nda_url?: string | null;
};

const KIND_LABEL: Record<string, string> = {
  nda: "waiting on NDA",
  cim: "waiting on CIM",
  broker_reply: "waiting on reply",
};

const btn =
  "inline-flex items-center rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:opacity-50";
const btnNeutral = `${btn} border-line bg-surface-raised text-ink-dim hover:border-line-bright hover:text-ink`;
const btnDiscuss = `${btn} border-discuss/40 bg-discuss-bg text-discuss hover:brightness-110`;

/**
 * Inbox watches + agentic review for pursuit mail that didn't hard-match.
 * Mail links always use authuser=dirk@ (never Tristan's default u/0).
 */
export function AttentionPanel({
  expectations,
  reviews,
}: {
  expectations: Expectation[];
  reviews: Review[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(
    async (
      payload:
        | { eventId: number; action: "confirm" | "dismiss"; dealId?: number }
        | { expectationId: number; action: "dismiss" },
    ) => {
      const busyKey =
        "expectationId" in payload ? `e-${payload.expectationId}` : `r-${payload.eventId}`;
      setBusyId(busyKey);
      setError(null);
      try {
        const res = await fetch("/api/crm/attention", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
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
          Opens dirk@ · armed by Act · else review
        </p>
      </div>

      {expectations.length > 0 && (
        <ul className="space-y-2">
          {expectations.map((e) => {
            const overdue = e.due_at ? new Date(e.due_at).getTime() < now : false;
            const mailHref = dirkMailHref({
              gmailThreadUrl: e.gmail_thread_url,
              searchQuery: e.title,
            });
            const hasThread = Boolean(e.gmail_thread_url?.trim());
            const busy = busyId === `e-${e.id}`;
            return (
              <li key={e.id} className="border-line space-y-2 rounded-lg border px-2.5 py-2">
                <div>
                  <a
                    href={mailHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink hover:text-accent text-[13px] font-semibold leading-snug"
                    title="Open in Dirk’s Gmail"
                  >
                    {e.title || `Deal ${e.deal_id}`}
                  </a>
                  <p className="text-ink-faint text-[11px]">
                    Watch · {e.nickname || "Listing"} · {KIND_LABEL[e.kind] || e.kind}
                    {overdue ? " · overdue" : ""}
                    {hasThread ? " · thread" : " · search"}
                  </p>
                </div>
                <ActionRow
                  mailHref={mailHref}
                  ndaUrl={e.nda_url}
                  dealId={e.deal_id}
                  busy={busy}
                  onDismiss={() => resolve({ expectationId: e.id, action: "dismiss" })}
                />
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
            {reviews.map((r) => {
              const mailHref = dirkMailHref({
                gmailThreadUrl: r.gmail_thread_url,
                searchQuery: r.subject || r.proposed_title,
              });
              const busy = busyId === `r-${r.id}`;
              return (
                <li key={r.id} className="border-line space-y-2 rounded-lg border px-2.5 py-2">
                  <div>
                    <a
                      href={mailHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink hover:text-accent text-[13px] font-semibold leading-snug"
                      title="Open in Dirk’s Gmail"
                    >
                      {r.subject || "(no subject)"}
                    </a>
                    <p className="text-ink-faint text-[11px]">
                      Review · {r.event_type.replace(/_/g, " ")} · {r.from_address || "unknown"}
                      {r.proposed_title ? ` · suggest: ${r.proposed_title}` : ""}
                    </p>
                  </div>
                  <ActionRow
                    mailHref={mailHref}
                    ndaUrl={r.nda_url}
                    dealId={r.deal_id}
                    busy={busy}
                    onConfirm={
                      r.deal_id != null
                        ? () =>
                            resolve({
                              eventId: r.id,
                              action: "confirm",
                              dealId: r.deal_id!,
                            })
                        : undefined
                    }
                    onDismiss={() => resolve({ eventId: r.id, action: "dismiss" })}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && <p className="text-pass text-[12px]">{error}</p>}
    </section>
  );
}

/** Shared actions: Sign NDA → Open in Dirk → Confirm (review only) → Deal → Dismiss */
function ActionRow({
  mailHref,
  ndaUrl,
  dealId,
  busy,
  onConfirm,
  onDismiss,
}: {
  mailHref: string;
  ndaUrl?: string | null;
  dealId: number | null;
  busy: boolean;
  onConfirm?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ndaUrl?.trim() && (
        <a href={ndaUrl.trim()} target="_blank" rel="noopener noreferrer" className={btnDiscuss}>
          Sign NDA
        </a>
      )}
      <a href={mailHref} target="_blank" rel="noopener noreferrer" className={btnNeutral}>
        Open in Dirk
      </a>
      {onConfirm && (
        <button type="button" disabled={busy} onClick={onConfirm} className={btnDiscuss}>
          Confirm match
        </button>
      )}
      {dealId != null && (
        <Link href={`/deals/${dealId}`} className={btnNeutral}>
          Deal →
        </Link>
      )}
      <button type="button" disabled={busy} onClick={onDismiss} className={btnNeutral}>
        Dismiss
      </button>
    </div>
  );
}
