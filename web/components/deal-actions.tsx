"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  BOARD_STAGES,
  type Deal,
  type MemberId,
  PASS_REASONS,
  type StageId,
  type VerdictAction,
} from "@/lib/model";
import { TrainAiButton } from "./train-ai-button";
import { VerdictNotePrompt } from "./verdict-note";

export function DealActions({ deal, member }: { deal: Deal; member: MemberId }) {
  const router = useRouter();
  const mine = deal.verdicts[member];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notePrompt, setNotePrompt] = useState<"short" | "discuss" | null>(null);

  async function setAction(
    action: VerdictAction | null,
    reason: string | null = null,
    note: string | null | undefined = undefined,
  ) {
    setBusy(true);
    setError(null);
    try {
      const clearing = action !== null && mine?.action === action && note === undefined;
      const next = clearing
        ? { action: null, reason: null, note: null }
        : {
            action,
            reason: action === "pass" ? reason : null,
            note:
              action === "short" || action === "discuss"
                ? (note !== undefined ? note : (mine?.note ?? null))
                : null,
          };

      const response = await fetch("/api/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.id, ...next }),
      });
      if (!response.ok) throw new Error("rejected");
      router.refresh();
    } catch {
      setError("Could not save that verdict.");
    } finally {
      setBusy(false);
    }
  }

  async function move(stage: StageId) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.id, stage }),
      });
      if (!response.ok) throw new Error("rejected");
      router.refresh();
    } catch {
      setError("Could not move that deal.");
    } finally {
      setBusy(false);
    }
  }

  function pickVerdict(action: VerdictAction) {
    if (mine?.action === action) {
      void setAction(null);
      setNotePrompt(null);
      return;
    }
    void setAction(action, action === "pass" ? (mine?.reason ?? null) : null);
    if (action === "short" || action === "discuss") setNotePrompt(action);
    else setNotePrompt(null);
  }

  return (
    <div className="space-y-3">
      {error && <p className="bg-pass-bg text-pass rounded-lg px-3 py-2 text-xs">{error}</p>}

      <div className="flex gap-1.5">
        <ActionButton
          active={mine?.action === "short"}
          tone="short"
          disabled={busy}
          onClick={() => pickVerdict("short")}
          title="Shortlist"
        >
          ✓
        </ActionButton>
        <ActionButton
          active={mine?.action === "discuss"}
          tone="discuss"
          disabled={busy}
          onClick={() => pickVerdict("discuss")}
        >
          Discuss
        </ActionButton>
        <ActionButton
          active={mine?.action === "pass"}
          tone="pass"
          disabled={busy}
          onClick={() => pickVerdict("pass")}
        >
          Pass
        </ActionButton>
      </div>

      {notePrompt && (
        <VerdictNotePrompt
          action={notePrompt}
          title={deal.title}
          note={mine?.note ?? null}
          onSave={(next) => {
            void setAction(notePrompt, null, next);
            setNotePrompt(null);
          }}
          onSkip={() => setNotePrompt(null)}
        />
      )}

      {mine?.action === "pass" && (
        <div className="border-line border-t border-dashed pt-3">
          <p className="text-ink-faint mb-2 text-xs font-semibold">Why pass?</p>
          <div className="flex flex-wrap gap-1.5">
            {PASS_REASONS.map((reason) => (
              <button
                key={reason}
                disabled={busy}
                onClick={() => setAction("pass", mine.reason === reason ? null : reason)}
                className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors ${
                  mine.reason === reason
                    ? "border-pass bg-pass text-white"
                    : "border-line bg-surface text-ink-dim hover:border-pass hover:bg-pass-bg hover:text-pass"
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="block">
        <span className="text-ink-faint mb-1.5 block text-[11.5px] font-bold tracking-wide uppercase">
          Pipeline stage
        </span>
        <select
          value={deal.stage === "inbox" ? "shortlist" : deal.stage}
          disabled={busy}
          onChange={(event) => move(event.target.value as StageId)}
          className="border-line bg-surface text-ink w-full rounded-lg border px-3 py-2.5 text-[13px] font-medium"
        >
          {deal.stage === "inbox" && <option value="inbox">Still in inbox</option>}
          {BOARD_STAGES.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.label}
            </option>
          ))}
        </select>
      </label>

      <TrainAiButton deal={deal} member={member} />
    </div>
  );
}

function ActionButton({
  active,
  tone,
  disabled,
  onClick,
  children,
  title,
}: {
  active: boolean;
  tone: "short" | "discuss" | "pass";
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  const activeTone = {
    short: "border-short bg-short text-white hover:brightness-110",
    discuss: "border-discuss bg-discuss text-white hover:brightness-110",
    pass: "border-pass bg-pass text-white hover:brightness-110",
  }[tone];

  const idleTone = {
    short: "border-line bg-surface text-short hover:border-short hover:bg-short-bg",
    discuss: "border-line bg-surface text-ink hover:border-discuss hover:bg-discuss-bg hover:text-discuss",
    pass: "border-line bg-surface text-ink hover:border-pass hover:bg-pass-bg hover:text-pass",
  }[tone];

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex-1 rounded-lg border py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50 ${
        active ? activeTone : idleTone
      }`}
    >
      {children}
    </button>
  );
}
