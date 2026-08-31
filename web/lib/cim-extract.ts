import { generateText, Output } from "ai";
import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";

/** Structured deal fields pulled from a CIM / teaser PDF. */
export const CimDraftSchema = z.object({
  title: z.string().describe("Business / opportunity name"),
  blurb: z
    .string()
    .describe("2–4 sentence summary of what the business does and why it matters"),
  city: z.string().nullable().describe("HQ or primary city if stated"),
  state: z
    .string()
    .nullable()
    .describe("Two-letter US state when possible, else region label"),
  revenue: z.number().nullable().describe("Annual revenue in USD (LTM preferred)"),
  ebitda: z
    .number()
    .nullable()
    .describe("EBITDA in USD when clearly labeled EBITDA — never invent from SDE"),
  sde: z
    .number()
    .nullable()
    .describe("SDE / seller discretionary earnings / cash flow when that is what the CIM shows"),
  asking: z.number().nullable().describe("Asking price in USD if disclosed"),
  businessModelType: z
    .enum(["LOCAL_SERVICE", "LOCATION_AGNOSTIC", "REGIONAL", "NATIONAL", "AMBIGUOUS"])
    .nullable()
    .describe(
      "LOCAL_SERVICE = men-in-a-truck / geo-bound; LOCATION_AGNOSTIC = ships/national customers; AMBIGUOUS if unsure",
    ),
  url: z.string().nullable().describe("Any listing or broker URL in the doc"),
  uncertainty: z
    .string()
    .nullable()
    .describe("Brief note on gaps, conflicting figures, or what to verify"),
});

export type CimDraft = z.infer<typeof CimDraftSchema>;

const EXTRACT_PROMPT = `You extract buy-side deal facts from a Confidential Information Memorandum (CIM) or broker summary for Nails & Mercy deal flow.

Rules:
- Prefer LTM / trailing twelve months when multiple years appear.
- Keep EBITDA and SDE separate. If the doc says "cash flow" or "seller discretionary", use sde not ebitda.
- Money as plain USD numbers (350000 not "$350K").
- If a field is missing or unclear, null — do not invent.
- Do not invent buy-box dislikes, hard-nos, exclusions, or pass reasons. Those live in the draft buy box and stay empty until Tristan edits them.
- Title should be the business name, not "Confidential Information Memorandum".
- Blurb: crisp operator-facing summary, not marketing fluff.`;

/** Pull plain text from a PDF (first ~N chars for the model). */
export async function pdfToText(bytes: Uint8Array, maxChars = 80_000): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

async function draftFromPrompt(
  prompt: string,
  filePart?: { data: Uint8Array; mediaType: string },
): Promise<CimDraft> {
  const result = await generateText({
    model: "anthropic/claude-sonnet-4.6",
    output: Output.object({ schema: CimDraftSchema }),
    messages: [
      {
        role: "user",
        content: filePart
          ? [
              { type: "text", text: prompt },
              { type: "file", data: filePart.data, mediaType: filePart.mediaType },
            ]
          : prompt,
      },
    ],
  });

  if (!result.output) {
    throw new Error("Model returned no structured extract.");
  }
  return result.output;
}

/**
 * LLM extract from CIM bytes.
 * Prefers PDF text path (works everywhere); falls back to file-part if text is thin.
 */
export async function extractDealFromCim(
  bytes: Uint8Array,
  filename: string,
): Promise<CimDraft> {
  const isPdf = filename.toLowerCase().endsWith(".pdf");
  let text = "";
  if (isPdf) {
    try {
      text = await pdfToText(bytes);
    } catch {
      text = "";
    }
  }

  if (text.length >= 400) {
    return draftFromPrompt(`${EXTRACT_PROMPT}\n\n--- CIM TEXT ---\n${text}`);
  }

  if (isPdf) {
    return draftFromPrompt(EXTRACT_PROMPT, {
      data: bytes,
      mediaType: "application/pdf",
    });
  }

  throw new Error(
    "Could not read that file. Upload a text-based PDF CIM (scanned images need OCR later).",
  );
}
