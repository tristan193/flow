import meta from "./repertoire.meta.json";
import type { DealRow, TrainListingReason } from "./model";

export type RepertoireFormatMeta = {
  id: string;
  format_family: string;
  source: string;
  sub_source: string;
  provider_subcategory: string;
  nickname: string;
  email_type: string;
  status: string;
  split: string;
  expected_fields: {
    present?: string[];
    absent?: string[];
    needs_llm_ok?: string[];
  };
  gotchas: string[];
  parser_notes: string[];
};

export type TrainInspection = {
  repertoire_path: string;
  playbook_path: string;
  format_id: string | null;
  provider_subcategory: string | null;
  format_status: string | null;
  email_type: string | null;
  focus_fields: string[];
  checklist: string[];
  suggested_gotcha: string;
  deal_snapshot: {
    deal_id: number;
    ext_id: string;
    title: string;
    source: string | null;
    sub_source: string | null;
    nickname: string | null;
    city: string | null;
    state: string | null;
    asking: number | null;
    revenue: number | null;
    ebitda: number | null;
    sde: number | null;
    url: string | null;
  };
};

const REASON_FIELDS: Record<TrainListingReason, string[]> = {
  "Wrong EBITDA, Rev, Asking Price": [
    "ebitda",
    "sde",
    "revenue",
    "asking",
    "expected_fields.absent",
    "gotchas",
  ],
  "Wrong Location": ["location", "city", "state", "county", "detect.body_open", "gotchas"],
  "Wrong Blurb": ["title", "blurb", "detect.subject_patterns", "gotchas"],
  "Duplicate listing": ["dedupe", "ext_id", "url"],
  "Not a real deal": ["email_type", "status", "split", "control"],
  Other: ["gotchas", "detect", "expected_fields"],
};

function formats(): RepertoireFormatMeta[] {
  return (meta as { formats: RepertoireFormatMeta[] }).formats ?? [];
}

function byEmail(): Record<string, string> {
  return (meta as { by_email: Record<string, string> }).by_email ?? {};
}

function subcategories(): Array<{
  id: string;
  email: string;
  default_format: string;
  provider_domain: string;
}> {
  return (
    (
      meta as {
        subcategories: Array<{
          id: string;
          email: string;
          default_format: string;
          provider_domain: string;
        }>;
      }
    ).subcategories ?? []
  );
}

/** Resolve the repertoire format most likely responsible for this deal. */
export function resolveFormatForDeal(
  deal: Pick<DealRow, "source" | "sub_source" | "nickname">,
): RepertoireFormatMeta | null {
  const email = (deal.sub_source || "").toLowerCase().trim();
  const domain = (deal.source || "").toLowerCase().trim();
  const nick = (deal.nickname || "").toLowerCase().trim();
  const all = formats();

  if (email && byEmail()[email]) {
    return all.find((f) => f.id === byEmail()[email]) ?? null;
  }

  if (email.includes("@")) {
    const sub = subcategories().find((s) => !s.email.startsWith("*") && s.email === email);
    if (sub?.default_format) {
      return all.find((f) => f.id === sub.default_format) ?? null;
    }
    const wildcard = subcategories().find((s) => {
      if (!s.email.startsWith("*@")) return false;
      const tail = s.email.slice(2);
      return domain === tail || domain.endsWith(`.${tail}`) || email.endsWith(`@${tail}`);
    });
    if (wildcard?.default_format) {
      return all.find((f) => f.id === wildcard.default_format) ?? null;
    }
  }

  // Legacy imports sometimes stored nickname in sub_source / source.
  const nickKey = nick || (!email.includes("@") ? email : "");
  if (nickKey) {
    const nickHits = all.filter((f) => f.nickname.toLowerCase() === nickKey);
    const active = nickHits.find((f) => f.status === "active") ?? nickHits[0];
    if (active) return active;
  }

  if (domain) {
    const domainHits = all.filter((f) => f.source === domain);
    const active = domainHits.find((f) => f.status === "active");
    if (active) return active;
    if (domainHits.length === 1) return domainHits[0];
  }
  return null;
}

/**
 * Inspect a listing-error Train-AI flag against the format repertoire.
 * Output is stored on train_flags.inspection and consumed by learn.py train-queue.
 */
export function inspectTrainFlag(
  deal: DealRow,
  reason: TrainListingReason,
  detail: string | null,
): TrainInspection {
  const fmt = resolveFormatForDeal(deal);
  const focus = REASON_FIELDS[reason] ?? REASON_FIELDS.Other;
  const checklist: string[] = [];

  if (fmt) {
    checklist.push(
      `Open pipeline/formats/repertoire.yaml → formats id \`${fmt.id}\` (subcategory ${fmt.provider_subcategory || "—"})`,
    );
    checklist.push(`Confirm detect still matches this mailbox (${fmt.sub_source || fmt.source})`);
    if (
      focus.some(
        (f) =>
          f.includes("expected_fields") ||
          ["asking", "ebitda", "sde", "revenue", "location", "title", "blurb"].includes(f),
      )
    ) {
      const present = (fmt.expected_fields.present || []).join(", ") || "—";
      const absent = (fmt.expected_fields.absent || []).join(", ") || "—";
      checklist.push(
        `Review expected_fields present=[${present}] absent=[${absent}] vs what the human flagged`,
      );
    }
    if (focus.includes("split") || focus.includes("detect")) {
      checklist.push(`Check split=${fmt.split} / status=${fmt.status} and parser_notes`);
    }
    if (reason === "Not a real deal") {
      checklist.push(
        "Consider status: control, email_type account_notice/newsletter_marketing, or split: drop",
      );
    }
    checklist.push("Append a gotcha (or tighten detect) so this failure mode is documented");
  } else {
    checklist.push(
      "No repertoire format matched this source/sub_source — add provider subcategory + format stub",
    );
    checklist.push("Survey the mailbox body, then learn.py propose → merge into repertoire.yaml");
  }
  if (detail?.trim()) {
    checklist.push(`Human note: ${detail.trim().slice(0, 240)}`);
  }

  const suggested = `Train AI (${reason}): ${detail?.trim() || deal.title}`.slice(0, 280);

  return {
    repertoire_path:
      (meta as { repertoire_path?: string }).repertoire_path || "pipeline/formats/repertoire.yaml",
    playbook_path:
      (meta as { playbook_path?: string }).playbook_path || "docs/deal-format-repertoire.md",
    format_id: fmt?.id ?? null,
    provider_subcategory: fmt?.provider_subcategory ?? null,
    format_status: fmt?.status ?? null,
    email_type: fmt?.email_type ?? null,
    focus_fields: focus,
    checklist,
    suggested_gotcha: suggested,
    deal_snapshot: {
      deal_id: deal.id,
      ext_id: deal.ext_id,
      title: deal.title,
      source: deal.source,
      sub_source: deal.sub_source,
      nickname: deal.nickname,
      city: deal.city,
      state: deal.state,
      asking: deal.asking,
      revenue: deal.revenue,
      ebitda: deal.ebitda,
      sde: deal.sde,
      url: deal.url,
    },
  };
}
