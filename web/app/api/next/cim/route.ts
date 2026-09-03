import { NextResponse, type NextRequest } from "next/server";

import { currentMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { applyAuthorizedCimLink } from "@/lib/next/cim-review";
import { getNextDeal, saveNextDealFile } from "@/lib/next/deals";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);

/**
 * Attach a CIM.
 *
 * JSON (member session or Bearer FLOW_IMPORT_TOKEN):
 *   { "dealId": 12, "url": "https://drive.google.com/drive/folders/..." }
 *   { "dealNumber": "TLY-007", "url": "https://drive.google.com/drive/folders/..." }
 *
 * Multipart file upload stays member-session only. Drive is the CIM home.
 */
export async function POST(request: NextRequest) {
  await ensureReady();
  const sessionMember = await currentMember();

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as {
      dealId?: number | string;
      dealNumber?: string;
      url?: string;
      actor?: string;
    } | null;
    const result = await applyAuthorizedCimLink({
      authorization: request.headers.get("authorization"),
      sessionMember,
      dealId: body?.dealId,
      dealNumber: body?.dealNumber,
      url: body?.url,
      actor: body?.actor,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      url: result.cimUrl,
      cimUrl: result.cimUrl,
      viewUrl: result.viewUrl ?? result.cimUrl,
      dealId: result.dealId,
      dealNumber: result.dealNumber,
    });
  }

  if (!sessionMember) {
    return NextResponse.json(
      {
        error:
          "File upload is members-only. Token path: POST JSON { dealNumber, url } with a Drive folder link.",
      },
      { status: 401 },
    );
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
    const saved = await saveNextDealFile(dealId, sessionMember, {
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
