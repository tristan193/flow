"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Confirm / Dismiss on a needs_review deal_log row. */
export function ResolveReview({ logId }: { logId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(resolution: "confirmed" | "dismissed") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/db/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: logId, resolution }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not resolve.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => void resolve("confirmed")}
        className="border-short/40 bg-short-bg text-short rounded-lg border px-2 py-1 text-[11.5px] font-semibold disabled:opacity-50"
      >
        Confirm
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void resolve("dismissed")}
        className="border-line bg-surface-raised text-ink-dim hover:text-ink rounded-lg border px-2 py-1 text-[11.5px] font-semibold disabled:opacity-50"
      >
        Dismiss
      </button>
      {error && <span className="text-pass text-[11px]">{error}</span>}
    </span>
  );
}
