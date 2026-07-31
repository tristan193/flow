"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Data tab for manual fallback only.
 *
 * Live deals arrive automatically from the GitHub Actions harvest
 * (dirk@ → ingest → Flow App /api/import). Drive is retired.
 */
export function ImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/import/upload", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      setMessage(`Uploaded ${file.name}: +${data.dealsNew} new, ${data.dealsUpdated} updated.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div className="border-line bg-surface rounded-xl border p-4">
        <h2 className="text-[14px] font-semibold">Live harvest</h2>
        <p className="text-ink-dim mt-1 text-[12.5px] leading-relaxed">
          Fresh deals arrive automatically from the GitHub Actions daily harvest (
          <code className="text-ink font-mono text-[11px]">dirk@</code> Gmail → ingest → this app).
          No Drive sync required. Check{" "}
          <span className="text-ink">Actions → Daily harvest</span> on the repo if something looks
          stale.
        </p>
      </div>

      <div className="border-line bg-surface rounded-xl border p-4">
        <h2 className="text-[14px] font-semibold">Manual CSV upload</h2>
        <p className="text-ink-dim mt-1 text-[12.5px] leading-relaxed">
          Fallback only — for a one-off snapshot from{" "}
          <code className="text-ink font-mono text-[11px]">pipeline/</code> when you need to push
          without waiting for the next scheduled run.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={upload}
          disabled={busy}
          className="text-ink-dim mt-3 block w-full text-[12.5px] file:border-line file:bg-surface-raised file:text-ink file:mr-3 file:rounded-lg file:border file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold"
        />
      </div>

      {message && (
        <p className="bg-short-bg text-short rounded-lg px-3 py-2 text-[12.5px]">{message}</p>
      )}
      {error && <p className="bg-pass-bg text-pass rounded-lg px-3 py-2 text-[12.5px]">{error}</p>}
    </div>
  );
}
