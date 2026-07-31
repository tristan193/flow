"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type NoteRow, memberLabel } from "@/lib/model";

export function NoteThread({ dealId, notes }: { dealId: number; notes: NoteRow[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, body }),
      });
      if (!response.ok) throw new Error("rejected");
      setBody("");
      router.refresh();
    } catch {
      setError("Could not save that note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-ink-faint mb-1.5 text-[11.5px] font-bold tracking-wide uppercase">
        Notes
      </h2>

      <form onSubmit={submit} className="mb-3 space-y-2">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder="Add a note for both of you…"
          className="border-line bg-surface focus:border-line-bright w-full resize-y rounded-xl border px-3.5 py-3 text-[13.5px] outline-none"
        />
        {error && <p className="text-pass text-xs">{error}</p>}
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className="bg-ink text-canvas rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-40"
        >
          {busy ? "Saving…" : "Add note"}
        </button>
      </form>

      {notes.length === 0 ? (
        <p className="text-ink-faint text-[12.5px]">No notes yet.</p>
      ) : (
        <ol className="border-line bg-surface divide-line divide-y rounded-xl border">
          {notes.map((note) => (
            <li key={note.id} className="px-3.5 py-3">
              <div className="text-ink-faint mb-1 flex items-baseline justify-between text-[11.5px]">
                <span className="font-semibold">{memberLabel(note.member)}</span>
                <span>{new Date(note.created_at).toLocaleString()}</span>
              </div>
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{note.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
