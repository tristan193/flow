import type { ReactNode } from "react";

const URL_RE = /<?(https?:\/\/[^\s<>\]]+)>?/gi;
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;

function urlCore(raw: string): string {
  let u = raw.trim().replace(/[)>,.\]]+$/, "").toLowerCase();
  if (u.endsWith("/")) u = u.slice(0, -1);
  if (u.includes("#")) u = u.split("#", 1)[0]!;
  if (u.includes("elink") || u.includes("mail.smbdealhunter")) return "";
  if (u.includes("?")) {
    const [base, qs = ""] = u.split("?", 2);
    const kept = qs
      .split("&")
      .filter(
        (p) =>
          p &&
          !p.startsWith("utm_") &&
          !p.startsWith("ref=") &&
          !p.startsWith("fbclid=") &&
          !p.startsWith("gclid=") &&
          !p.startsWith("mc_"),
      );
    u = kept.length ? `${base}?${kept.join("&")}` : (base ?? "");
  }
  return u;
}

function sameDestination(a: string, b: string | null | undefined): boolean {
  if (!b) return false;
  const ca = urlCore(a);
  const cb = urlCore(b);
  return Boolean(ca && cb && ca === cb);
}

function shouldOmitUrl(href: string, listingUrl: string | null | undefined): boolean {
  if (sameDestination(href, listingUrl)) return true;
  // Tracking / digest wrappers — "View original listing" already covers the deal.
  if (listingUrl && (href.includes("elink") || href.includes("mail.smbdealhunter"))) {
    return true;
  }
  return false;
}

/**
 * Renders a deal blurb for the card / detail page:
 * - strips Helen digest "#1:" / "#2:" prefixes
 * - turns leftover URLs into a short "link" (or omits if same as View original)
 */
export function BlurbText({
  text,
  listingUrl,
  empty = "No description in the source email.",
}: {
  text: string | null | undefined;
  listingUrl?: string | null;
  empty?: string;
}) {
  if (!text?.trim()) {
    return <>{empty}</>;
  }

  let working = text.trim().replace(/^#?\d+[:.]\s*/, "");
  // Flatten markdown links to either omit or keep the label + short link later.
  working = working.replace(MD_LINK_RE, (_m, label: string, href: string) => {
    if (shouldOmitUrl(href, listingUrl)) return label;
    return `${label} ${href}`;
  });

  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(URL_RE.source, "gi");
  let key = 0;

  while ((match = re.exec(working)) !== null) {
    const href = match[1]!;
    const start = match.index;
    if (start > last) {
      nodes.push(working.slice(last, start));
    }
    if (!shouldOmitUrl(href, listingUrl)) {
      nodes.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-discuss underline-offset-2 hover:underline"
        >
          link
        </a>,
      );
    }
    last = start + match[0].length;
  }
  if (last < working.length) {
    nodes.push(working.slice(last));
  }

  const cleaned = nodes
    .map((n) => (typeof n === "string" ? n.replace(/\s+/g, " ") : n))
    .filter((n) => !(typeof n === "string" && !n.trim()));

  if (cleaned.length === 0) {
    return <>{empty}</>;
  }

  // Trim leading/trailing whitespace-only string chunks.
  const first = cleaned[0];
  if (typeof first === "string") cleaned[0] = first.trimStart();
  const lastNode = cleaned[cleaned.length - 1];
  if (typeof lastNode === "string") cleaned[cleaned.length - 1] = lastNode.trimEnd();

  return <>{cleaned}</>;
}
