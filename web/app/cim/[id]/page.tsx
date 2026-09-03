import { notFound, redirect } from "next/navigation";

import { resolveStoredCim } from "@/lib/cim-open";
import { parseCimDealId } from "@/lib/cim-pack-id";

export const dynamic = "force-dynamic";

/**
 * Deterministic CIM URL. `/cim/TLY-092` looks up the deal and 302/307s to the
 * stamped Drive file URL. No Google credentials. Missing URL → "CIM not in yet".
 */
export default async function CimPackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let result;
  try {
    result = await resolveStoredCim(id);
  } catch {
    const dealNumber = parseCimDealId(id);
    result = dealNumber ? { status: "missing" as const, dealNumber } : { status: "invalid" as const };
  }

  if (result.status === "invalid") notFound();
  if (result.status === "found") redirect(result.viewUrl);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">CIM not in yet</h1>
      <p className="text-ink-dim mt-2 text-[14px] leading-relaxed">
        No CIM file is stamped on {result.dealNumber} yet.
      </p>
    </main>
  );
}
