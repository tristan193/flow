"use client";

import { useState } from "react";

import type { Deal, MemberId } from "@/lib/model";
import { ActionDeck } from "./action-deck";
import { PipelineBoard } from "./pipeline-board";

export function PipelineClient({ deals, member }: { deals: Deal[]; member: MemberId }) {
  const [mode, setMode] = useState<"act" | "board">("act");

  return (
    <div className="space-y-3">
      <div className="border-line bg-surface flex gap-1 rounded-xl border p-1">
        {([
          { id: "act" as const, label: "Act" },
          { id: "board" as const, label: "Board" },
        ]).map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setMode(option.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-[13.5px] font-semibold transition-colors ${
              mode === option.id
                ? "bg-surface-raised text-ink"
                : "text-ink-faint hover:bg-surface-raised/60 hover:text-ink-dim"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === "act" ? (
        <ActionDeck deals={deals} member={member} />
      ) : (
        <PipelineBoard deals={deals} member={member} />
      )}
    </div>
  );
}
