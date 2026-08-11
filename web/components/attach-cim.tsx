"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/** CIM on an existing deal — board is View/Add only; detail also allows Replace. */
export function AttachCim({
  dealId,
  cimUrl,
  compact = false,
}: {
  dealId: number;
  cimUrl: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justUploaded, setJustUploaded] = useState<string | null>(null);

  const hasCim = Boolean(cimUrl || justUploaded);
  const openUrl = cimUrl;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("dealId", String(dealId));
      body.set("file", file);
      const response = await fetch("/api/deal-files", { method: "POST", body });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
        filename?: string;
      };
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      setJustUploaded(data.filename || file.name);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void upload(file);
      }}
    />
  );

  if (compact) {
    const buttonClass =
      "inline-flex items-center rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50";
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {fileInput}
        {openUrl ? (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass} border-flag/40 bg-flag-bg text-flag hover:brightness-110`}
          >
            View CIM
          </a>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className={`${buttonClass} border-line bg-surface-raised text-ink-dim hover:border-line-bright hover:text-ink`}
          >
            {busy ? "Uploading…" : "Add CIM"}
          </button>
        )}
        {error && <span className="text-pass text-[11px]">{error}</span>}
      </span>
    );
  }

  return (
    <section className="border-line bg-surface space-y-2 rounded-xl border px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">CIM</p>
        <div className="flex items-center gap-3">
          {openUrl && (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-flag text-[12.5px] font-semibold"
            >
              View CIM
            </a>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="text-discuss text-[12.5px] font-semibold disabled:opacity-50"
          >
            {busy ? "Uploading…" : hasCim ? "Replace CIM" : "Add CIM"}
          </button>
        </div>
      </div>

      {fileInput}

      {justUploaded && !busy && (
        <p className="text-ink text-[13px] font-medium">{justUploaded} · saved</p>
      )}
      {!hasCim && !busy && (
        <p className="text-ink-faint text-[12.5px]">
          PDF or Word · max 4MB · attach anytime, not only after outreach.
        </p>
      )}
      {error && <p className="text-pass text-[12px]">{error}</p>}
    </section>
  );
}
