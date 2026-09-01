import { NextResponse } from "next/server";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { getNextDeal, saveNextCimLink, saveNextDealFile } from "@/lib/next/deals";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);

export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as {
      dealId?: number;
      url?: string;
    } | null;
    const dealId = Number(body?.dealId);
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!Number.isInteger(dealId) || dealId <= 0 || !url) {
      return NextResponse.json({ error: "Need dealId and url." }, { status: 400 });
    }
    const deal = await getNextDeal(dealId);
    if (!deal) return NextResponse.json({ error: "Deal not found." }, { status: 404 });
    await saveNextCimLink(dealId, member, url);
    return NextResponse.json({ ok: true, url });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart form or JSON." }, { status: 400 });
  }

  const dealId = Number(form.get("dealId"));
  const file = form.get("file");
  if (!Number.isInteger(dealId) || dealId <= 0) {
    return NextResponse.json({ error: "Invalid deal." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  }

  const deal = await getNextDeal(dealId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }

  const fileType = file.type || "application/octet-stream";
  if (!ALLOWED.has(fileType) && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Upload a PDF or Word CIM." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const saved = await saveNextDealFile(dealId, member, {
      filename: file.name || "cim.pdf",
      contentType: fileType === "application/octet-stream" ? "application/pdf" : fileType,
      bytes,
    });
    return NextResponse.json({ ok: true, id: saved.id, url: saved.url, filename: file.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
