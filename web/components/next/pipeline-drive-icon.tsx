import { isDriveUrl } from "@/lib/next/cim-drive";

/** Tiny Drive affordance on the progress board. Not a CIM reader. */
export function PipelineDriveIcon({ url }: { url: string | null }) {
  if (!url) return null;
  const drive = isDriveUrl(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={drive ? "Open CIM in Drive" : "Open CIM"}
      aria-label={drive ? "Open CIM in Drive" : "Open CIM"}
      className="border-line bg-surface-raised text-flag hover:border-flag/50 inline-flex h-8 w-8 items-center justify-center rounded-lg border"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
        <path d="M7.5 4.5 2 14h5.2l5.5-9.5H7.5Zm9.1 0-3.3 5.7 3.2 5.6H22L16.6 4.5ZM1 15.5l3.3 5.7h15.4L22.9 15.5H1Z" />
      </svg>
    </a>
  );
}
