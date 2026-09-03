"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { cimPackPath } from "@/lib/cim-pack-id";
import { assessNextFit } from "@/lib/next/fit";
import {
  CIM_VERDICT_LABELS,
  cimCombineHint,
  memberLabel,
  nextCimDeck,
  partnerNotesOnly,
  type MemberId,
  type NextDeal,
  type NextNoteRow,
  type VerdictAction,
} from "@/lib/next/model";
import { DealTitleStack, FitStrip, MetricRow, VerdictChips, Where } from "./deal-card";

type NotesMap = Record<number, NextNoteRow[]>;

export function CimReviewClient({
  deals,
  notesByDealId,
  member,
}: {
  deals: NextDeal[];
  notesByDealId: NotesMap;
  member: MemberId;
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<number, VerdictAction | null>>({});
  const [skipped, setSkipped] = useState<number[]>([]);
  const [failed, setFailed] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  const scored = useMemo(
    () => deals.map((deal) => ({ ...deal, fit: assessNextFit(deal) })),
    [deals],
  );

  const queue = useMemo(() => {
    const withOverrides = scored.map((deal) => {
      if (!Object.prototype.hasOwnProperty.call(overrides, deal.id)) return deal;
      const action = overrides[deal.id];
      return {
        ...deal,
        cim_verdicts: action
          ? {
              ...deal.cim_verdicts,
              [member]: {
                action,
                deal_id: deal.id,
                member,
                reason: null,
                note: null,
                created_at: "",
                updated_at: "",
              },
            }
          : { ...deal.cim_verdicts, [member]: undefined },
      };
    });
    return nextCimDeck(withOverrides, member).filter((deal) => !skipped.includes(deal.id));
  }, [scored, overrides, skipped, member]);

  const top = queue[0];

  const send = useCallback(
    async (dealId: number, action: VerdictAction | null) => {
      try {
        const response = await fetch("/api/next/cim/verdict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId, action }),
        });
        if (!response.ok) throw new Error("rejected");
        setFailed(false);
        router.refresh();
      } catch {
        setFailed(true);
      }
    },
    [router],
  );

  const commit = useCallback(
    (deal: NextDeal, action: VerdictAction) => {
      setOverrides((prev) => ({ ...prev, [deal.id]: action }));
      void send(deal.id, action);
      setNoteDraft("");
    },
    [send],
  );

  async function saveNote(dealId: number) {
    const body = noteDraft.trim();
    if (!body) return;
    setNoteBusy(true);
    try {
      const response = await fetch("/api/next/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, body }),
      });
      if (!response.ok) throw new Error("rejected");
      setNoteDraft("");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setNoteBusy(false);
    }
  }

  if (deals.length === 0) {
    return (
      <div className="border-line bg-surface rounded-xl border p-4 text-sm">
        <p className="font-medium">Nothing at CIM</p>
        <p className="text-ink-dim mt-1.5 leading-relaxed">
          Cards reach this deck when they have a stamped Drive file URL (<code>cim_url</code>).
          Stage CIM alone is not enough. Pipeline stays a progress board.
        </p>
      </div>
    );
  }

  if (!top) {
    return (
      <div className="py-12 text-center">
        <p className="text-[17px] font-semibold">CIM deck clear</p>
        <p className="text-ink-dim mt-1.5 text-[13.5px]">
          You have voted these packs. They stay at CIM until both of you Pass or both Pursue.
        </p>
      </div>
    );
  }

  const packHref = cimPackPath(top.deal_number);
  const partnerNotes = partnerNotesOnly(notesByDealId[top.id] ?? []);

  return (
    <div className="space-y-3">
      {failed && (
        <p className="bg-pass-bg text-pass rounded-lg px-3 py-2 text-xs">
          Could not save that. Check your connection.
        </p>
      )}

      <p className="text-ink-faint text-[12px]">{cimCombineHint(top.cim_verdicts)}</p>

      <article className="border-line bg-surface overflow-hidden rounded-2xl border shadow-xl shadow-black/40">
        <FitStrip fit={top.fit} />
        <div className="space-y-3 p-4">
          {packHref ? (
            <a
              href={packHref}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-ink text-canvas hover:brightness-110 block rounded-xl px-4 py-3 text-center text-[15px] font-semibold"
            >
              View CIM
            </a>
          ) : null}
          <MetricRow deal={top} fit={top.fit} />
          <DealTitleStack
            deal={top}
            titleAs="h2"
            titleClassName="text-[18px] leading-snug font-semibold"
          />
          <Where deal={top} />

          <VerdictChips deal={top} member={member} lane="cim" />

          <section className="space-y-2">
            <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">Notes</p>
            <div className="flex gap-2">
              <input
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="Add a note for your partner"
                className="border-line bg-surface-raised text-ink flex-1 rounded-lg border px-3 py-2 text-[13px]"
              />
              <button
                type="button"
                disabled={noteBusy || !noteDraft.trim()}
                onClick={() => void saveNote(top.id)}
                className="bg-ink text-canvas rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
              >
                Save
              </button>
            </div>
            {partnerNotes.length > 0 && (
              <ol className="max-h-28 space-y-1.5 overflow-y-auto">
                {partnerNotes.map((note) => (
                  <li key={note.id} className="text-[13px] leading-relaxed">
                    <span className="text-ink-faint font-semibold">
                      {note.member === member ? "You" : memberLabel(note.member)} ·{" "}
                    </span>
                    {note.body}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="border-line flex items-center justify-between border-t pt-2">
            <Link href={`/next/deals/${top.id}`} className="text-ink-faint text-[11.5px]">
              Details
            </Link>
            <button
              type="button"
              onClick={() => setSkipped((prev) => [...prev, top.id])}
              className="text-ink-faint text-[11.5px]"
            >
              Skip
            </button>
          </div>
        </div>
      </article>

      <div className="flex items-center justify-center gap-3">
        <CimButton tone="pass" onClick={() => commit(top, "pass")}>
          Pass
        </CimButton>
        <CimButton tone="discuss" onClick={() => commit(top, "discuss")}>
          Hold
        </CimButton>
        <CimButton tone="short" onClick={() => commit(top, "short")}>
          Pursue
        </CimButton>
      </div>
      <p className="text-ink-faint text-center text-[11.5px]">
        {queue.length} left in your CIM deck · {CIM_VERDICT_LABELS.discuss} stays CIM
      </p>
    </div>
  );
}

function CimButton({
  tone,
  onClick,
  children,
}: {
  tone: "short" | "discuss" | "pass";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const idle = {
    short: "border-line bg-surface text-short hover:border-short hover:bg-short-bg",
    discuss: "border-line bg-surface text-discuss hover:border-discuss hover:bg-discuss-bg",
    pass: "border-line bg-surface text-pass hover:border-pass hover:bg-pass-bg",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-[88px] rounded-full border px-5 py-3 text-[14px] font-semibold ${idle}`}
    >
      {children}
    </button>
  );
}
