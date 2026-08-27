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

const mailBtn =
  "inline-flex items-center rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-[12px] font-semibold text-ink-dim transition-colors hover:border-line-bright hover:text-ink";

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
      payload: { eventId: number; action: "confirm" | "dismiss"; dealId?: number } | {
        expectationId: number;
        action: "dismiss";
      },
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
            return (
              <li
                key={e.id}
                className="border-line flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={mailHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink hover:text-accent block truncate text-[13px] font-semibold"
                    title="Open in Dirk’s Gmail"
                  >
                    {e.title || `Deal ${e.deal_id}`}
                  </a>
                  <p className="text-ink-faint text-[11px]">
                    {e.nickname || "Listing"} · {KIND_LABEL[e.kind] || e.kind}
                    {overdue ? " · overdue" : ""}
                    {hasThread ? " · thread" : " · search"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {e.nda_url?.trim() && (
                    <a
                      href={e.nda_url.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-discuss/40 bg-discuss-bg text-discuss inline-flex items-center rounded-lg border px-2.5 py-1 text-[12px] font-semibold"
                    >
                      Sign NDA
                    </a>
                  )}
                  <a
                    href={mailHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={mailBtn}
                  >
                    Open in Dirk
                  </a>
                  <Link
                    href={`/deals/${e.deal_id}`}
                    className="text-ink-dim hover:text-ink text-[12px] font-semibold"
                  >
                    Deal →
                  </Link>
                  <button
                    type="button"
                    disabled={busyId === `e-${e.id}`}
                    onClick={() => resolve({ expectationId: e.id, action: "dismiss" })}
                    className="border-line bg-surface-raised text-ink-dim hover:text-ink rounded-lg border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
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
              return (
                <li
                  key={r.id}
                  className="border-line space-y-2 rounded-lg border px-2.5 py-2"
                >
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
                      {r.event_type.replace(/_/g, " ")} · {r.from_address || "unknown"} ·{" "}
                      {r.status}
                      {r.proposed_title ? ` · suggest: ${r.proposed_title}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={mailHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={mailBtn}
                    >
                      Open in Dirk
                    </a>
                    {r.deal_id != null && (
                      <button
                        type="button"
                        disabled={busyId === `r-${r.id}`}
                        onClick={() =>
                          resolve({ eventId: r.id, action: "confirm", dealId: r.deal_id! })
                        }
                        className="border-discuss/40 bg-discuss-bg text-discuss rounded-lg border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50"
                      >
                        Confirm match
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === `r-${r.id}`}
                      onClick={() => resolve({ eventId: r.id, action: "dismiss" })}
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
              );
            })}
          </ul>
        </div>
      )}

      {error && <p className="text-pass text-[12px]">{error}</p>}
    </section>
  );
}
