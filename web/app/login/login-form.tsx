"use client";

import { useState } from "react";

export function LoginForm({ next }: { next?: string }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Could not sign in.");
        setBusy(false);
        return;
      }

      // A full navigation rather than a client push, so the new session cookie is
      // picked up by middleware on the way in.
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch {
      setError("Network problem. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="passcode" className="text-ink-dim block text-sm">
        Your passcode
      </label>
      <input
        id="passcode"
        type="password"
        inputMode="text"
        autoComplete="current-password"
        autoFocus
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        className="border-line bg-surface focus:border-line-bright w-full rounded-xl border px-4 py-3 text-base outline-none"
        placeholder="••••••••"
      />

      {error && <p className="text-pass text-sm">{error}</p>}

      <button
        type="submit"
        disabled={busy || passcode.length === 0}
        className="bg-ink text-canvas w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-40"
      >
        {busy ? "Checking…" : "Sign in"}
      </button>

      <p className="text-ink-faint pt-2 text-xs leading-relaxed">
        You and your partner each have your own passcode, which is how Flow knows whose verdicts
        are whose.
      </p>
    </form>
  );
}
