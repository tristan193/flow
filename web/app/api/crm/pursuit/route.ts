import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ensureReady } from "@/lib/boot";
import {
  applyPursuitEvent,
  type CrmEventType,
  type PursuitEventInput,
} from "@/lib/crm-pursuit";
import { MAX_CIM_BYTES } from "@/lib/deals";
import { importTokenValid } from "@/lib/import-auth";

export const runtime = "nodejs";
/** Allow CIM upload in the same request (base64). */
export const maxDuration = 60;

const eventSchema = z.object({
  gmailMessageId: z.string().min(1),
  gmailThreadId: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  fromAddress: z.string().nullable().optional(),
  bodyText: z.string().nullable().optional(),
  eventType: z.enum([
    "nda_available",
    "nda_signed",
    "cim_received",
    "vdr_access",
    "broker_message",
  ]),
  ndaUrl: z.string().nullable().optional(),
  gmailThreadUrl: z.string().nullable().optional(),
  matchHints: z
    .object({
      dealNumber: z.string().nullable().optional(),
      titleCue: z.string().nullable().optional(),
      listingIds: z.array(z.string()).nullable().optional(),
    })
    .optional(),
  fileBase64: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  fileContentType: z.string().nullable().optional(),
});

const bodySchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
});

/**
 * Machine endpoint: harvest posts pursuit events (NDA links, CIM files).
 * Auth: same bearer as /api/import.
 */
export async function POST(request: NextRequest) {
  if (!importTokenValid(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await ensureReady();

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pursuit payload.", detail: parsed.error.flatten() }, { status: 400 });
  }

  const results = [];
  for (const event of parsed.data.events) {
    let file: PursuitEventInput["file"] = null;
    if (event.fileBase64 && event.fileName) {
      try {
        const bytes = Uint8Array.from(Buffer.from(event.fileBase64, "base64"));
        if (bytes.byteLength > MAX_CIM_BYTES) {
          results.push({
            gmailMessageId: event.gmailMessageId,
            status: "skipped",
            dealId: null,
            detail: `File too large (max ${MAX_CIM_BYTES / (1024 * 1024)}MB)`,
          });
          continue;
        }
        file = {
          filename: event.fileName,
          contentType: event.fileContentType || "application/pdf",
          bytes,
        };
      } catch {
        results.push({
          gmailMessageId: event.gmailMessageId,
          status: "skipped",
          dealId: null,
          detail: "Bad file encoding",
        });
        continue;
      }
    }

    const input: PursuitEventInput = {
      gmailMessageId: event.gmailMessageId,
      gmailThreadId: event.gmailThreadId,
      subject: event.subject,
      fromAddress: event.fromAddress,
      bodyText: event.bodyText,
      eventType: event.eventType as CrmEventType,
      ndaUrl: event.ndaUrl,
      gmailThreadUrl: event.gmailThreadUrl,
      matchHints: event.matchHints,
      file,
    };
    results.push(await applyPursuitEvent(input));
  }

  return NextResponse.json({ ok: true, results });
}
