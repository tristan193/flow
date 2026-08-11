"use client";

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
  if (!ndaUrl && !gmailThreadUrl) return null;

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
        {gmailThreadUrl && (
          <a
            href={gmailThreadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass} border-line bg-surface-raised text-ink-dim hover:border-line-bright hover:text-ink`}
          >
            Open email
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
        {gmailThreadUrl && (
          <a
            href={gmailThreadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass} border-line bg-surface-raised text-ink-dim hover:border-line-bright hover:text-ink`}
          >
            Open email thread
          </a>
        )}
      </div>
      <p className="text-ink-faint text-[12px]">
        Detected from broker mail. Signing happens outside Flow; use Act cards when done.
      </p>
    </section>
  );
}
