"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { assessFit } from "@/lib/fit";
import {
  type Deal,
  type MemberId,
  OUTREACH_OUTCOMES,
  type OutreachOutcomeId,
  stageLabel,
} from "@/lib/model";
import { isActionableDeal, resolvePlaybook } from "@/lib/playbooks";
import { CimNewTabLink } from "./cim-new-tab-link";
import {
  CardFooter,
  FitStrip,
  LeadLine,
  MetricRow,
  VerdictChips,
  Where,
} from "./deal-card";
import { BlurbText } from "./blurb-text";

type Scored = Deal & { fit: ReturnType<typeof assessFit> };

const PENDING_KEY = "flow.action.pendingDebrief";

function readPendingId(): number | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function writePendingId(id: number | null) {
  try {
    if (id == null) sessionStorage.removeItem(PENDING_KEY);
    else sessionStorage.setItem(PENDING_KEY, String(id));
  } catch {
    /* private mode */
  }
}

/**
 * Swipe-style deck for post-shortlist work: pursue on Axial (playbook link-out),
 * then a debrief — not a status CRM.
 */
export function ActionDeck({ deals, member }: { deals: Deal[]; member: MemberId }) {
  const router = useRouter();
  const queue = useMemo(
    () =>
      deals
        .filter(isActionableDeal)
        .map((deal) => ({ ...deal, fit: assessFit(deal) })),
    [deals],
  );

  const [skipped, setSkipped] = useState<number[]>([]);
  const [doneIds, setDoneIds] = useState<number[]>([]);
  const [debriefFor, setDebriefFor] = useState<Scored | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedAt = useRef<number | null>(null);

  const visible = useMemo(
    () => queue.filter((d) => !skipped.includes(d.id) && !doneIds.includes(d.id)),
    [queue, skipped, doneIds],
  );

  const top = visible[0] ?? null;
  const playbook = top ? resolvePlaybook(top) : null;

  const showDebriefForId = useCallback(
    (dealId: number) => {
      const deal =
        queue.find((d) => d.id === dealId) ??
        deals
          .filter(isActionableDeal)
          .map((d) => ({ ...d, fit: assessFit(d) }))
          .find((d) => d.id === dealId);
      if (!deal) return;
      if (doneIds.includes(deal.id) || skipped.includes(deal.id)) return;
      setDebriefFor(deal);
    },
    [queue, deals, doneIds, skipped],
  );

  // Restore pending debrief after tab return / remount (Pursue opens Axial in
  // another tab — coming back must still prompt "what happened").
  useEffect(() => {
    const pending = readPendingId();
    if (pending != null) showDebriefForId(pending);

    function onReturn() {
      if (document.visibilityState !== "visible") return;
      const id = readPendingId();
      if (id == null) return;
      // Ignore the immediate focus blip right as the new tab opens.
      if (openedAt.current && Date.now() - openedAt.current < 800) return;
      showDebriefForId(id);
    }

    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
    };
  }, [showDebriefForId]);

  const skip = useCallback((deal: Deal) => {
    writePendingId(null);
    openedAt.current = null;
    setSkipped((prev) => (prev.includes(deal.id) ? prev : [...prev, deal.id]));
    setDebriefFor(null);
  }, []);

  const openLink = useCallback((deal: Scored) => {
    const pb = resolvePlaybook(deal);
    writePendingId(deal.id);
    openedAt.current = Date.now();
    setDebriefFor(deal);
    if (pb?.href) {
      window.open(pb.href, "_blank", "noopener,noreferrer");
    }
  }, []);

  const submitDebrief = useCallback(
    async (
      deal: Deal,
      outcomes: OutreachOutcomeId[],
      note: string | null,
      cimUrl: string | null,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId: deal.id, outcomes, note, cimUrl }),
        });
        if (!response.ok) throw new Error("rejected");
        writePendingId(null);
        openedAt.current = null;
        setDoneIds((prev) => [...prev, deal.id]);
        setDebriefFor(null);
        router.refresh();
      } catch {
        setError("Could not save that. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  if (queue.length === 0) {
    return (
      <div className="border-line bg-surface rounded-xl border px-4 py-10 text-center">
        <p className="text-[15px] font-semibold">Nothing to pursue yet</p>
        <p className="text-ink-dim mt-1.5 text-[13px] leading-relaxed">
          Shortlist a deal that has a listing link — it lands here ready to open.
        </p>
      </div>
    );
  }

  if (!top || !playbook) {
    return (
      <div className="border-line bg-surface rounded-xl border px-4 py-10 text-center">
        <p className="text-[15px] font-semibold">Queue clear</p>
        <p className="text-ink-dim mt-1.5 text-[13px]">
          {doneIds.length + skipped.length} done this session · Board for the full trail
        </p>
      </div>
    );
  }

  const awaitingReturn = debriefFor != null;

  return (
    <div className="space-y-3">
      <p className="text-ink-faint text-[12px]">
        {visible.length} to pursue · open the listing, then log what you did
      </p>

      {error && <p className="bg-pass-bg text-pass rounded-lg px-3 py-2 text-xs">{error}</p>}

      <div className={`relative ${awaitingReturn ? "min-h-[280px]" : "h-[520px]"}`}>
        {!awaitingReturn &&
          visible
            .slice(0, 3)
            .reverse()
            .map((deal, index, arr) => {
              const depth = arr.length - 1 - index;
              const isTop = depth === 0;
              const pb = resolvePlaybook(deal);
              return (
                <div
                  key={deal.id}
                  className="border-line bg-surface absolute inset-0 flex flex-col overflow-hidden rounded-2xl border shadow-xl shadow-black/40"
                  style={{
                    zIndex: 10 - depth,
                    transform: `translateY(${depth * 8}px) scale(${1 - depth * 0.03})`,
                  }}
                >
                  <FitStrip fit={deal.fit} />
                  <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-4 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <StageBadge stage={deal.stage} />
                      <span className="text-ink-faint text-[11px]">{deal.nickname || "Axial"}</span>
                    </div>
                    <MetricRow deal={deal} fit={deal.fit} large />
                    <div>
                      <h2 className="text-[18px] leading-snug font-semibold">{deal.title}</h2>
                      <div className="mt-1">
                        <Where deal={deal} />
                      </div>
                    </div>
                    {isTop ? (
                      <div className="text-ink-dim min-h-0 flex-1 overflow-auto text-[13.5px] leading-relaxed">
                        <BlurbText text={deal.blurb} listingUrl={deal.url} />
                      </div>
                    ) : (
                      <div className="flex-1">
                        <LeadLine deal={deal} lines={2} />
                      </div>
                    )}
                    <VerdictChips deal={deal} member={member} />
                    <CardFooter deal={deal} />
                  </div>

                  {isTop && pb && (
                    <div className="border-line bg-surface-raised space-y-2 border-t px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openLink(deal)}
                        className="bg-discuss text-canvas hover:brightness-110 w-full rounded-xl py-3.5 text-[15px] font-bold tracking-tight shadow-lg shadow-black/30"
                      >
                        {pb.ctaLabel}
                      </button>
                      <p className="text-ink-faint text-center text-[11.5px]">{pb.hint}</p>
                      <button
                        type="button"
                        onClick={() => skip(deal)}
                        className="text-ink-faint hover:text-ink-dim w-full py-1 text-[12px]"
                      >
                        Later
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

        {awaitingReturn && debriefFor && (
          <div className="border-line bg-surface overflow-hidden rounded-2xl border shadow-xl shadow-black/40">
            <div className="border-line flex items-center justify-between gap-2 border-b px-4 py-2.5">
              <StageBadge stage={debriefFor.stage} />
              <p className="text-ink min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                {debriefFor.title}
              </p>
            </div>
            <div className="p-4">
              <DebriefPanel
                deal={debriefFor}
                busy={busy}
                onSkip={() => skip(debriefFor)}
                onSubmit={(outcomes, note, cimUrl) =>
                  submitDebrief(debriefFor, outcomes, note, cimUrl)
                }
              />
            </div>
          </div>
        )}
      </div>

      <div className="text-ink-faint flex justify-between text-[11.5px]">
        <Link href={`/deals/${(debriefFor ?? top).id}`} className="hover:text-ink-dim">
          Full deal
        </Link>
        {(debriefFor ?? top).cim_url && (
          <CimNewTabLink href={(debriefFor ?? top).cim_url!} className="text-discuss">
            Open CIM →
          </CimNewTabLink>
        )}
      </div>
    </div>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const tone: Record<string, string> = {
    shortlist: "bg-short-bg text-short border-short/40",
    contacted: "bg-discuss-bg text-discuss border-discuss/40",
    nda: "bg-discuss-bg text-discuss border-discuss/40",
    cim: "bg-flag-bg text-flag border-flag/40",
    call: "bg-discuss-bg text-discuss border-discuss/40",
    loi: "bg-flag-bg text-flag border-flag/40",
    diligence: "bg-flag-bg text-flag border-flag/40",
    offer: "bg-flag-bg text-flag border-flag/40",
    closed: "bg-short-bg text-short border-short/40",
    dead: "bg-surface-raised text-ink-faint border-line",
  };
  return (
    <span
      className={`shrink-0 rounded-md border px-2 py-0.5 text-[10.5px] font-bold tracking-[0.06em] uppercase ${
        tone[stage] ?? "bg-surface-raised text-ink-dim border-line"
      }`}
    >
      {stageLabel(stage)}
    </span>
  );
}

function DebriefPanel({
  deal,
  busy,
  onSkip,
  onSubmit,
}: {
  deal: Deal;
  busy: boolean;
  onSkip: () => void;
  onSubmit: (outcomes: OutreachOutcomeId[], note: string | null, cimUrl: string | null) => void;
}) {
  const [picked, setPicked] = useState<OutreachOutcomeId[]>([]);
  const [note, setNote] = useState("");
  const [cimUrl, setCimUrl] = useState(deal.cim_url ?? "");
  const [cimName, setCimName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function uploadCim(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.set("dealId", String(deal.id));
      body.set("file", file);
      const response = await fetch("/api/deal-files", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        filename?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || "Upload failed.");
      }
      setCimUrl(payload.url);
      setCimName(payload.filename || file.name);
      if (!picked.includes("cim_received")) {
        setPicked((prev) => [...prev, "cim_received"]);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function toggle(id: OutreachOutcomeId) {
    setPicked((prev) => {
      const on = prev.includes(id);
      if (id === "cim_received" && !on) {
        // Open the native file picker as soon as they log a CIM download.
        queueMicrotask(() => fileRef.current?.click());
      }
      return on ? prev.filter((x) => x !== id) : [...prev, id];
    });
  }

  const blocked = busy || uploading;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-ink text-[15px] font-semibold">Welcome back — log what you did</p>
        <p className="text-ink-dim mt-0.5 text-[12.5px]">
          Then we&apos;ll advance the pipeline and pull the next deal.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {OUTREACH_OUTCOMES.map((outcome) => {
          const on = picked.includes(outcome.id);
          return (
            <button
              key={outcome.id}
              type="button"
              disabled={blocked}
              onClick={() => toggle(outcome.id)}
              className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                on
                  ? "border-discuss bg-discuss text-canvas"
                  : "border-line bg-surface-raised text-ink-dim hover:border-discuss hover:text-discuss"
              }`}
            >
              {outcome.label}
            </button>
          );
        })}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadCim(file);
        }}
      />

      {(picked.includes("cim_received") || cimUrl || cimName) && (
        <div className="border-line bg-surface space-y-2 rounded-lg border px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">
              CIM file
            </p>
            <button
              type="button"
              disabled={blocked}
              onClick={() => fileRef.current?.click()}
              className="text-discuss text-[12px] font-semibold"
            >
              {cimName || cimUrl ? "Replace file" : "Choose file"}
            </button>
          </div>
          {uploading && <p className="text-ink-dim text-[12.5px]">Uploading…</p>}
          {cimName && !uploading && (
            <p className="text-ink text-[13px] font-medium">{cimName} · ready</p>
          )}
          {!cimName && cimUrl && !uploading && (
            <CimNewTabLink href={cimUrl} className="text-discuss text-[13px]">
              Existing CIM link →
            </CimNewTabLink>
          )}
          {uploadError && <p className="text-pass text-[12px]">{uploadError}</p>}
          <p className="text-ink-faint text-[11px]">PDF or Word · max 4MB · Jim can open it on the deal</p>
        </div>
      )}

      <label className="block">
        <span className="text-ink-faint mb-1 block text-[11px] font-semibold tracking-wide uppercase">
          Note for Jim (optional)
        </span>
        <textarea
          ref={noteRef}
          value={note}
          disabled={blocked}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything worth sharing…"
          className="border-line bg-surface text-ink placeholder:text-ink-faint w-full resize-y rounded-lg border px-3 py-2 text-[13px] outline-none"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={blocked}
          onClick={onSkip}
          className="border-line bg-surface-raised text-ink-dim flex-1 rounded-lg border py-2.5 text-[13px] font-semibold"
        >
          Skip
        </button>
        <button
          type="button"
          disabled={blocked || picked.length === 0}
          onClick={() => onSubmit(picked, note.trim() || null, cimUrl.trim() || null)}
          className="bg-ink text-canvas flex-[2] rounded-lg py-2.5 text-[13px] font-semibold disabled:opacity-40"
        >
          Save & next
        </button>
      </div>
    </div>
  );
}
