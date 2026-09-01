"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { NextNoteRow } from "@/lib/next/model";
import { memberLabel } from "@/lib/next/model";

export function NextNotes({ dealId, notes }: { dealId: number; notes: NextNoteRow[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const response = await fetch("/api/next/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, body: trimmed }),
      });
      if (!response.ok) throw new Error("rejected");
      setBody("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-ink-faint text-[11.5px] font-bold tracking-wide uppercase">Notes</h2>
      <div className="flex gap-2">
        <input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a note for your partner"
          className="border-line bg-surface text-ink flex-1 rounded-lg border px-3 py-2 text-[13px]"
        />
        <button
          type="button"
          disabled={busy || !body.trim()}
          onClick={() => void submit()}
          className="bg-ink text-canvas rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {notes.length > 0 && (
        <ol className="border-line bg-surface divide-line divide-y rounded-xl border">
          {notes.map((note) => (
            <li key={note.id} className="px-3.5 py-2.5">
              <p className="text-[13px] leading-relaxed">{note.body}</p>
              <p className="text-ink-faint mt-1 text-[11px]">
                {memberLabel(note.member)} · {new Date(note.created_at).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
