import { NextResponse } from "next/server";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { importCsv } from "@/lib/import";

/**
 * Manual CSV upload, for when a snapshot is at hand and waiting for a Drive sync
 * would just be friction. Takes the pipeline's export shape.
 */
export async function POST(request: Request) {
  await ensureReady();
  await requireMember();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a CSV file to upload." }, { status: 400 });
  }

  const text = await file.text();
  if (!text.trim()) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }

  try {
    const result = await importCsv(text, "upload", file.name);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read that CSV." },
      { status: 400 },
    );
  }
}
