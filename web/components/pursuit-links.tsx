"use client";

import { normalizeGmailThreadUrl } from "@/lib/gmail-thread";

/** NDA / Gmail thread links from pursuit-lane mail (human signs; app links). */
export function PursuitLinks({
  ndaUrl,
  gmailThreadUrl,
  compact = false,
}: {
  ndaUrl: string | null;
  gmailThreadUrl: string | null;
  compact?: boolean;
}) {
  const threadHref = normalizeGmailThreadUrl(gmailThreadUrl);
  if (!ndaUrl && !threadHref) return null;

  const buttonClass =
    "inline-flex items-center rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors";

  if (compact) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {ndaUrl && (
          <a
            href={ndaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass} border-discuss/40 bg-discuss-bg text-discuss hover:brightness-110`}
          >
            Sign NDA
          </a>
        )}
        {threadHref && (
          <a
            href={threadHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass} border-line bg-surface-raised text-ink-dim hover:border-line-bright hover:text-ink`}
          >
            Open in Dirk
          </a>
        )}
      </span>
    );
  }

  return (
    <section className="border-line bg-surface space-y-2 rounded-xl border px-3.5 py-3">
      <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">Pursuit</p>
      <div className="flex flex-wrap gap-2">
        {ndaUrl && (
          <a
            href={ndaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass} border-discuss/40 bg-discuss-bg text-discuss hover:brightness-110`}
          >
            Sign NDA
          </a>
        )}
        {threadHref && (
          <a
            href={threadHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass} border-line bg-surface-raised text-ink-dim hover:border-line-bright hover:text-ink`}
          >
            Open in Dirk
          </a>
        )}
      </div>
      <p className="text-ink-faint text-[12px]">
        Opens dirk@ in Gmail (you must be signed into that account). Signing happens outside
        Flow; use Act cards when done.
      </p>
    </section>
  );
}
