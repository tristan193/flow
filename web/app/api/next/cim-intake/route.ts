import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ensureReady } from "@/lib/boot";
import { applyAuthorizedCimIntake } from "@/lib/next/cim-intake";

/**
 * Simon's agent stamps a Drive file URL + optional pack numbers onto the
 * existing TLY row and moves it to CIM. One card. No Google on Vercel.
 *
 *   Authorization: Bearer FLOW_IMPORT_TOKEN
 *   POST /api/next/cim-intake
 *   {
 *     "fileName": "TLY-092 Project Cactus.pdf",
 *     "cimUrl": "https://drive.google.com/file/d/FILE_ID/view",
 *     "dealNumber": "TLY-092",
 *     "revenue": 4200000,
 *     "ebitda": 920000,
 *     "margin": 0.22,
 *     "asking": 6500000,
 *     "cimName": "Project Cactus",
 *     "city": "Austin",
 *     "state": "TX"
 *   }
 *
 * fileName and cimUrl required. dealNumber, financials, cimName, and geo optional.
 * Canonical JSON key for the CIM company / project / nickname is `cimName`
 * (aliases: cim_name, companyName, company_name, headline). Empty/omitted
 * leaves title and cim_name alone. When present, writes deals_next.cim_name
 * and keeps the teaser in title (card headline / subline).
 *
 * Geo (primary): `city`, `state`. Optional: `country`, `county`, `location`.
 *   city     aliases: City
 *   state    aliases: State, region, Region
 *   country  aliases: Country — no deals_next.country column; writes `state`
 *            when state is omitted (foreign HQ, e.g. country="Bermuda")
 *   county   aliases: County — accepted, never required
 *   location aliases: Location — best-effort parse into city/state when those
 *            are missing ("Austin, TX" → Austin / TX). Does not invent geo.
 * Non-empty trimmed values overwrite deals_next.city / state / county.
 * Omitted or blank geo fields leave the existing DB values alone.
 * TLY comes from the filename; posted dealNumber must match if present.
 * Token only — a browser session is not enough.
 */

const schema = z.object({
  fileName: z.unknown().optional(),
  file_name: z.unknown().optional(),
  filename: z.unknown().optional(),
  cimUrl: z.unknown().optional(),
  cim_url: z.unknown().optional(),
  dealNumber: z.unknown().optional(),
  deal_number: z.unknown().optional(),
  revenue: z.unknown().optional(),
  ebitda: z.unknown().optional(),
  margin: z.unknown().optional(),
  asking: z.unknown().optional(),
  asking_price: z.unknown().optional(),
  price: z.unknown().optional(),
  cimName: z.unknown().optional(),
  cim_name: z.unknown().optional(),
  companyName: z.unknown().optional(),
  company_name: z.unknown().optional(),
  headline: z.unknown().optional(),
  city: z.unknown().optional(),
  City: z.unknown().optional(),
  state: z.unknown().optional(),
  State: z.unknown().optional(),
  region: z.unknown().optional(),
  Region: z.unknown().optional(),
  county: z.unknown().optional(),
  County: z.unknown().optional(),
  country: z.unknown().optional(),
  Country: z.unknown().optional(),
  location: z.unknown().optional(),
  Location: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  await ensureReady();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid CIM intake." }, { status: 400 });
  }

  const result = await applyAuthorizedCimIntake({
    authorization: request.headers.get("authorization"),
    fileName: parsed.data.fileName ?? parsed.data.file_name ?? parsed.data.filename,
    cimUrl: parsed.data.cimUrl ?? parsed.data.cim_url,
    dealNumber: parsed.data.dealNumber ?? parsed.data.deal_number,
    revenue: parsed.data.revenue,
    ebitda: parsed.data.ebitda,
    margin: parsed.data.margin,
    asking: parsed.data.asking ?? parsed.data.asking_price ?? parsed.data.price,
    cimName: parsed.data.cimName,
    cim_name: parsed.data.cim_name,
    companyName: parsed.data.companyName,
    company_name: parsed.data.company_name,
    headline: parsed.data.headline,
    city: parsed.data.city,
    City: parsed.data.City,
    state: parsed.data.state,
    State: parsed.data.State,
    region: parsed.data.region,
    Region: parsed.data.Region,
    county: parsed.data.county,
    County: parsed.data.County,
    country: parsed.data.country,
    Country: parsed.data.Country,
    location: parsed.data.location,
    Location: parsed.data.Location,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    dealId: result.dealId,
    dealNumber: result.dealNumber,
    stage: result.stage,
    cimUrl: result.cimUrl,
    revenue: result.revenue,
    ebitda: result.ebitda,
    margin: result.margin,
    asking: result.asking,
    cimName: result.cimName,
    city: result.city,
    state: result.state,
    county: result.county,
    deal: result.deal,
  });
}
