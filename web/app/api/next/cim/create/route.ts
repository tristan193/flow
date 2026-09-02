import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { MAX_CIM_BYTES, createNextDealFromCim } from "@/lib/next/cim-create";

export const runtime = "nodejs";
export const maxDuration = 30;

const DraftBody = z.object({
  title: z.string().min(1),
  blurb: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  revenue: z.number().nullable().optional(),
  ebitda: z.number().nullable().optional(),
  sde: z.number().nullable().optional(),
  asking: z.number().nullable().optional(),
  businessModelType: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  brokerFirm: z.string().nullable().optional(),
});

function numOrNull(value: FormDataEntryValue | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(value: FormDataEntryValue | null): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart form." }, { status: 400 });
  }

  const parsed = DraftBody.safeParse({
    title: strOrNull(form.get("title")) ?? "",
    blurb: strOrNull(form.get("blurb")),
    city: strOrNull(form.get("city")),
    state: strOrNull(form.get("state")),
    revenue: numOrNull(form.get("revenue")),
    ebitda: numOrNull(form.get("ebitda")),
    sde: numOrNull(form.get("sde")),
    asking: numOrNull(form.get("asking")),
    businessModelType: strOrNull(form.get("businessModelType")),
    url: strOrNull(form.get("url")),
    brokerFirm: strOrNull(form.get("brokerFirm")),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const file = form.get("file");
  let filePayload: { filename: string; contentType: string; bytes: Uint8Array } | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CIM_BYTES) {
      return NextResponse.json(
        { error: `File too large — max ${MAX_CIM_BYTES / (1024 * 1024)}MB.` },
        { status: 400 },
      );
    }
    const contentType = file.type || "application/pdf";
    filePayload = {
      filename: file.name || "cim.pdf",
      contentType: contentType === "application/octet-stream" ? "application/pdf" : contentType,
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  }

  try {
    const deal = await createNextDealFromCim(
      member,
      {
        title: parsed.data.title,
        blurb: parsed.data.blurb ?? null,
        city: parsed.data.city ?? null,
        state: parsed.data.state ?? null,
        revenue: parsed.data.revenue ?? null,
        ebitda: parsed.data.ebitda ?? null,
        sde: parsed.data.sde ?? null,
        asking: parsed.data.asking ?? null,
        businessModelType: parsed.data.businessModelType ?? null,
        url: parsed.data.url ?? null,
        brokerFirm: parsed.data.brokerFirm ?? null,
      },
      filePayload,
    );
    return NextResponse.json({ ok: true, deal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create deal.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
