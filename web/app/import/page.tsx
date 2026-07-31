import { Nav } from "@/components/nav";
import { ImportPanel } from "@/components/import-panel";
import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { query } from "@/lib/db";
import { memberLabel } from "@/lib/model";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await ensureReady();
  const member = await requireMember();

  const runs = await query<{
    id: number;
    source: string;
    detail: string | null;
    deals_new: number;
    deals_updated: number;
    verdicts_applied: number;
    created_at: string | Date;
  }>("SELECT * FROM import_runs ORDER BY created_at DESC LIMIT 20");

  return (
    <>
      <Nav memberLabel={memberLabel(member)} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <div className="mb-3">
          <h1 className="text-lg font-semibold tracking-tight">Data</h1>
          <p className="text-ink-dim text-[12.5px]">
            Live feed is the GitHub harvest — manual upload is fallback only
          </p>
        </div>

        <ImportPanel />

        <section className="mt-6">
          <h2 className="text-ink-faint mb-1.5 text-[11.5px] font-bold tracking-wide uppercase">
            Recent imports
          </h2>
          {runs.length === 0 ? (
            <p className="text-ink-faint text-[12.5px]">Nothing imported yet.</p>
          ) : (
            <ol className="border-line bg-surface divide-line divide-y rounded-xl border">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="text-ink-dim flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[12.5px]"
                >
                  <span>
                    <span className="text-ink font-medium">{run.source}</span>
                    {run.detail ? ` · ${run.detail}` : ""} · +{run.deals_new} new ·{" "}
                    {run.deals_updated} updated
                    {run.verdicts_applied > 0 ? ` · ${run.verdicts_applied} verdicts` : ""}
                  </span>
                  <span className="text-ink-faint shrink-0">
                    {new Date(run.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </>
  );
}
