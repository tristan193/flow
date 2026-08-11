"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/** Attach or replace a CIM on an existing deal — no outreach debrief required. */
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

  const openUrl = cimUrl;
  const label = openUrl || justUploaded ? "Replace CIM" : "Attach CIM";

  if (compact) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-flag font-medium"
          >
            CIM →
          </a>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="text-ink-dim hover:text-ink text-[12px] font-medium disabled:opacity-50"
        >
          {busy ? "Uploading…" : label}
        </button>
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
        {error && <span className="text-pass text-[11px]">{error}</span>}
      </span>
    );
  }

  return (
    <section className="border-line bg-surface space-y-2 rounded-xl border px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">CIM</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="text-discuss text-[12.5px] font-semibold disabled:opacity-50"
        >
          {busy ? "Uploading…" : label}
        </button>
      </div>

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

      {openUrl && (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-flag block text-[13px] font-medium"
        >
          Open CIM →
        </a>
      )}
      {justUploaded && !busy && (
        <p className="text-ink text-[13px] font-medium">{justUploaded} · saved</p>
      )}
      {!openUrl && !justUploaded && !busy && (
        <p className="text-ink-faint text-[12.5px]">
          PDF or Word · max 4MB · attach anytime, not only after outreach.
        </p>
      )}
      {error && <p className="text-pass text-[12px]">{error}</p>}
    </section>
  );
}
