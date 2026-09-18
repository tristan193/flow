"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CimNewTabLink } from "../cim-new-tab-link";

/**
 * CIM attach on Next deals — URL only (Drive / Canva / data room). Uploads are
 * retired; stamping a link advances the deal to CIM.
 */
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [showLinkField, setShowLinkField] = useState(false);

  const openUrl = cimUrl;

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
      setShowLinkField(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save link.");
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    const buttonClass =
      "inline-flex items-center rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50";
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {openUrl ? (
          <CimNewTabLink
            href={openUrl}
            className={`${buttonClass} border-flag/40 bg-flag-bg text-flag hover:brightness-110`}
          >
            View CIM
          </CimNewTabLink>
        ) : showLinkField ? (
          <span className="inline-flex items-center gap-1.5">
            <input
              type="url"
              value={link}
              autoFocus
              onChange={(event) => setLink(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveLink();
                if (event.key === "Escape") setShowLinkField(false);
              }}
              placeholder="CIM / data-room URL"
              className="border-line bg-surface-raised text-ink placeholder:text-ink-faint w-44 rounded-lg border px-2 py-1.5 text-[12px]"
            />
            <button
              type="button"
              disabled={busy || !link.trim()}
              onClick={() => void saveLink()}
              className={`${buttonClass} border-line bg-surface-raised text-ink-dim hover:border-line-bright hover:text-ink`}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowLinkField(true)}
            className={`${buttonClass} border-line bg-surface-raised text-ink-dim hover:border-line-bright hover:text-ink`}
          >
            Add CIM
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
        {openUrl && (
          <CimNewTabLink href={openUrl} className="text-flag text-[12.5px] font-semibold">
            View CIM
          </CimNewTabLink>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder={openUrl ? "Replace with a new CIM / data-room URL" : "Paste a data-room / CIM URL"}
          className="border-line bg-surface-raised text-ink placeholder:text-ink-faint flex-1 rounded-lg border px-3 py-2 text-[13px]"
        />
        <button
          type="button"
          disabled={busy || !link.trim()}
          onClick={() => void saveLink()}
          className="border-line bg-surface-raised text-ink-dim hover:text-ink rounded-lg border px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save link"}
        </button>
      </div>

      {!openUrl && !busy && (
        <p className="text-ink-faint text-[12.5px]">
          Drive, Canva, or broker data-room URL · saving moves the deal to CIM.
        </p>
      )}
      {error && <p className="text-pass text-[12px]">{error}</p>}
    </section>
  );
}
