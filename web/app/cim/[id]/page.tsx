import { notFound, redirect } from "next/navigation";

import { lookupCimPack } from "@/lib/cim-pack";

export const dynamic = "force-dynamic";

/**
 * One route for every deal. `/cim/tly-031` and `/cim/TLY-031` both look up
 * a PDF whose name starts with TLY-031 in the shared Drive parent folder.
 */
export default async function CimPackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await lookupCimPack(id);

  if (result.status === "invalid") notFound();
  if (result.status === "found") redirect(result.viewUrl);

  const headline = result.status === "disconnected" ? "Drive is not connected" : "CIM not in yet";
  const detail =
    result.status === "disconnected"
      ? "This app has no Google Drive credentials, so it cannot look up the pack."
      : "No CIM PDF with that deal number is in the shared Drive folder yet.";

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">{headline}</h1>
      <p className="text-ink-dim mt-2 text-[14px] leading-relaxed">{detail}</p>
    </main>
  );
}
