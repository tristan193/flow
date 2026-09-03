"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { MemberId, NextNoteRow } from "@/lib/next/model";
import { cimPartnerNoteFields, memberLabel } from "@/lib/next/model";

/**
 * Tristan / Jim notes on a CIM-stage card. Both labels always render at CIM
 * (empty partner field stays visible). Hidden entirely before CIM. Simon
 * never appears. The logged-in member writes via POST /api/next/notes.
 */
export function CimPartnerNotes({
  dealId,
  deal,
  notes,
  member,
}: {
  dealId: number;
  deal: { stage: string };
  notes?: NextNoteRow[] | null;
  member: MemberId;
}) {
  const fields = cimPartnerNoteFields(deal, notes);
  if (!fields) return null;

  return (
    <section className="space-y-3">
      {fields.map((field) => {
        const mine = field.member === member;
        return (
          <div key={field.member}>
            <p className="text-ink-faint text-[11px] font-bold tracking-wide uppercase">
              {field.label}
            </p>
            {field.notes.length > 0 ? (
              <ol className="mt-1 max-h-28 space-y-1 overflow-y-auto">
                {field.notes.map((note) => (
                  <li key={note.id} className="text-[13px] leading-relaxed">
                    {note.body}
                  </li>
                ))}
              </ol>
            ) : mine ? null : (
              <p className="text-ink-faint mt-1 text-[12px]">None yet</p>
            )}
            {mine ? <OwnNoteComposer dealId={dealId} /> : null}
          </div>
        );
      })}
    </section>
  );
}

function OwnNoteComposer({ dealId }: { dealId: number }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/next/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, body: trimmed }),
      });
      if (!response.ok) throw new Error("rejected");
      setBody("");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex gap-2">
        <input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a note"
          className="border-line bg-surface-raised text-ink flex-1 rounded-lg border px-3 py-2 text-[13px]"
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
      {failed ? (
        <p className="text-pass text-[11px]">Could not save that. Check your connection.</p>
      ) : null}
    </div>
  );
}

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
