import { cimLinkLabel, isDriveUrl } from "@/lib/next/cim-drive";
import { memberLabel, type NextNoteRow } from "@/lib/next/model";

/** Drive CIM folder + Simon's written review. Not a verdict. */
export function CimPack({
  cimUrl,
  simonReview,
  compact = false,
}: {
  cimUrl: string | null;
  simonReview: NextNoteRow | null;
  compact?: boolean;
}) {
  if (!cimUrl && !simonReview) return null;

  if (compact) {
    return (
      <div className="border-flag/30 bg-flag-bg/40 space-y-1.5 rounded-lg border px-2.5 py-2">
        {cimUrl && <CimDriveLink url={cimUrl} compact />}
        {simonReview && (
          <p className="text-ink text-[12.5px] leading-relaxed">
            <span className="text-ink-faint font-semibold tracking-wide uppercase">
              {memberLabel(simonReview.member)} ·{" "}
            </span>
            {simonReview.body}
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="border-flag/30 bg-flag-bg/30 space-y-2 rounded-xl border px-3.5 py-3">
      <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">
        CIM pack · Drive
      </p>
      {cimUrl ? (
        <CimDriveLink url={cimUrl} />
      ) : (
        <p className="text-ink-faint text-[12.5px]">
          Dirk creates the Drive folder at Shortlist. Simon uploads the CIM PDF
          when the review is done.
        </p>
      )}
      {simonReview ? (
        <div>
          <p className="text-ink-faint mb-1 text-[11px] font-bold tracking-wide uppercase">
            {memberLabel(simonReview.member)}&apos;s review
          </p>
          <p className="text-ink text-[13.5px] leading-relaxed">{simonReview.body}</p>
          <p className="text-ink-faint mt-1 text-[11px]">
            {new Date(simonReview.created_at).toLocaleDateString()} · written review, not a
            verdict
          </p>
        </div>
      ) : (
        <p className="text-ink-faint text-[12.5px]">Simon has not posted a review yet.</p>
      )}
    </section>
  );
}

export function CimDriveLink({ url, compact = false }: { url: string; compact?: boolean }) {
  const drive = isDriveUrl(url);
  const label = cimLinkLabel(url);
  if (compact) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-flag inline-flex items-center text-[12.5px] font-semibold hover:underline"
      >
        {label} →
      </a>
    );
  }
  return (
    <div className="space-y-1">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-flag inline-flex items-center text-[14px] font-semibold hover:underline"
      >
        {label} →
      </a>
      <p className="text-ink-faint break-all text-[11.5px]">{url}</p>
      {drive && (
        <p className="text-ink-faint text-[11px]">
          Dirk created this folder. Simon uploads the CIM PDF here when the review
          is done.
        </p>
      )}
    </div>
  );
}
