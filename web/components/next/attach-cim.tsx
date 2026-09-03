"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { CimNewTabLink } from "../cim-new-tab-link";

/** CIM attach on Next deals — file or web URL. Advances stage to CIM / data room. */
export function NextAttachCim({
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
  const [link, setLink] = useState("");

  const hasCim = Boolean(cimUrl || justUploaded);
  const openUrl = cimUrl;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("dealId", String(dealId));
      body.set("file", file);
      const response = await fetch("/api/next/cim", { method: "POST", body });
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

  async function saveLink() {
    const url = link.trim();
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/next/cim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, url }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save link.");
      setLink("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save link.");
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
          <CimNewTabLink
            href={openUrl}
            className={`${buttonClass} border-flag/40 bg-flag-bg text-flag hover:brightness-110`}
          >
            View CIM
          </CimNewTabLink>
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
            <CimNewTabLink href={openUrl} className="text-flag text-[12.5px] font-semibold">
              View CIM
            </CimNewTabLink>
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

      <div className="flex gap-2">
        <input
          type="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="Or paste a data-room / CIM URL"
          className="border-line bg-surface-raised text-ink placeholder:text-ink-faint flex-1 rounded-lg border px-3 py-2 text-[13px]"
        />
        <button
          type="button"
          disabled={busy || !link.trim()}
          onClick={() => void saveLink()}
          className="border-line bg-surface-raised text-ink-dim hover:text-ink rounded-lg border px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50"
        >
          Save link
        </button>
      </div>

      {justUploaded && !busy && (
        <p className="text-ink text-[13px] font-medium">{justUploaded} · saved</p>
      )}
      {!hasCim && !busy && (
        <p className="text-ink-faint text-[12.5px]">
          PDF or Word · max 4MB · attaching moves the deal to CIM / data room.
        </p>
      )}
      {error && <p className="text-pass text-[12px]">{error}</p>}
    </section>
  );
}
