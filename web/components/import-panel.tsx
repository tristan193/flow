"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function ImportPanel({ driveReady }: { driveReady: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"drive" | "upload" | null>(null);

  async function syncDrive() {
    setBusy("drive");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/import/drive", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Drive sync failed.");
      setMessage(
        data.filesImported?.length
          ? `Imported ${data.filesImported.length} file(s): +${data.dealsNew} new, ${data.dealsUpdated} updated.`
          : `Nothing new. Skipped ${data.filesSkipped ?? 0} already-seen file(s).`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drive sync failed.");
    } finally {
      setBusy(null);
    }
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy("upload");
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
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div className="border-line bg-surface rounded-xl border p-4">
        <h2 className="text-[14px] font-semibold">Google Drive</h2>
        <p className="text-ink-dim mt-1 text-[12.5px] leading-relaxed">
          Pulls dated CSV snapshots from the shared Nails &amp; Mercy Drive folder. Already-imported
          files are skipped.
        </p>
        {driveReady ? (
          <button
            onClick={syncDrive}
            disabled={busy !== null}
            className="bg-ink text-canvas mt-3 rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-40"
          >
            {busy === "drive" ? "Syncing…" : "Sync from Drive"}
          </button>
        ) : (
          <p className="text-flag mt-3 text-[12.5px] leading-relaxed">
            Drive is not connected yet. Add{" "}
            <code className="text-ink font-mono text-[11px]">GOOGLE_SERVICE_ACCOUNT_JSON</code> and{" "}
            <code className="text-ink font-mono text-[11px]">FLOW_DRIVE_FOLDER_ID</code> to the
            environment, then share the folder with the service account as a Viewer.
          </p>
        )}
      </div>

      <div className="border-line bg-surface rounded-xl border p-4">
        <h2 className="text-[14px] font-semibold">Upload a CSV</h2>
        <p className="text-ink-dim mt-1 text-[12.5px] leading-relaxed">
          Accepts the pipeline export shape (
          <code className="text-ink font-mono text-[11px]">deals_export.csv</code> or a dated Drive
          snapshot).
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={upload}
          disabled={busy !== null}
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
