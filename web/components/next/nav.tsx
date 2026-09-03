"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/next", label: "Review" },
  { href: "/next/pipeline", label: "Pipeline" },
];

export function NextNav({ memberLabel }: { memberLabel: string }) {
  const pathname = usePathname();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="border-line bg-canvas/95 sticky top-0 z-20 border-b backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
        <span className="text-base font-semibold tracking-tight">
          Flow
          <span className="text-flag ms-1.5 text-[11px] font-bold tracking-wide uppercase">
            Next
          </span>
        </span>

        <nav className="flex flex-1 items-center gap-1">
          {TABS.map((tab) => {
            const active =
              tab.href === "/next" ? pathname === "/next" : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-surface-raised text-ink" : "text-ink-dim hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col items-end gap-0.5">
          <button
            onClick={signOut}
            className="text-ink-faint hover:text-ink-dim text-xs leading-none"
            title={`Signed in as ${memberLabel} · click to sign out`}
          >
            {memberLabel}
          </button>
          <Link href="/pipeline" className="text-ink-faint hover:text-ink-dim text-[11px] leading-none">
            Classic
          </Link>
        </div>
      </div>
    </header>
  );
}
