/** Catcher inbox — harvest + pursuit mail lives here, not Tristan's personal Gmail. */
export const CATCHER_GMAIL = "dirk@tullyinvesting.com";

const AUTH_QUERY = `authuser=${encodeURIComponent(CATCHER_GMAIL)}`;
const DIRK_AUTHUSER_RE = /(?:\?|&)authuser=dirk(?:%40|@)tullyinvesting\.com(?:&|#|$)/i;
const MAIL_U_RE = /\/mail\/u\/\d+/i;
const THREAD_HASH_RE = /#(all|inbox|sent|search|label\/[^/?#]+)\/([a-zA-Z0-9]+)/i;
const BARE_THREAD_RE = /^[a-zA-Z0-9]+$/;

function canonicalThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/?${AUTH_QUERY}#all/${threadId}`;
}

function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Pull a Gmail thread id from a bare id, `#all/{id}` hash, or AccountChooser continue URL. */
export function extractGmailThreadId(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const text = raw.trim();
  if (BARE_THREAD_RE.test(text)) return text;

  const hash = text.match(THREAD_HASH_RE);
  if (hash?.[2]) return hash[2];

  const decoded = decodeMaybe(text);
  if (decoded !== text) {
    const nested = decoded.match(THREAD_HASH_RE);
    if (nested?.[2]) return nested[2];
  }

  try {
    const u = new URL(text);
    const cont = u.searchParams.get("continue");
    if (cont) return extractGmailThreadId(cont);
  } catch {
    // not a URL
  }
  return null;
}

/** True when a href forces dirk@ and does not pin browser account /u/N. */
export function isDirkForcedGmailHref(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  const raw = url.trim();
  if (MAIL_U_RE.test(raw)) return false;
  if (DIRK_AUTHUSER_RE.test(raw)) return true;
  return (
    /accounts\.google\.com\/AccountChooser/i.test(raw) &&
    /(?:\?|&)Email=dirk(?:%40|@)tullyinvesting\.com(?:&|#|$)/i.test(raw)
  );
}

/** Deep-link a Gmail thread in Dirk's account (authuser), not browser u/0. */
export function gmailCatcherThreadUrl(threadId: string): string {
  const id = threadId.trim();
  if (!id) return "";
  const extracted = extractGmailThreadId(id);
  return extracted ? canonicalThreadUrl(extracted) : canonicalThreadUrl(id);
}

/**
 * Next + Dirk API name for the same helper. Accepts a thread id or a legacy
 * Gmail URL and always returns the canonical dirk@ authuser form.
 */
export function gmailAllHref(threadId: string): string {
  return gmailCatcherThreadUrl(threadId);
}

/** Search Dirk's mailbox (authuser) — used when we have a title but no thread yet. */
export function gmailCatcherSearchUrl(query: string): string {
  const q = query.trim();
  const auth = encodeURIComponent(CATCHER_GMAIL);
  if (!q) return `https://mail.google.com/mail/?authuser=${auth}#inbox`;
  return `https://mail.google.com/mail/?authuser=${auth}#search/${encodeURIComponent(q)}`;
}

/**
 * Rewrite legacy `/mail/u/0/#all/…` (and any Gmail URL missing authuser)
 * to the canonical Dirk thread link. AccountChooser with Email=dirk@ is
 * acceptable when no thread id can be recovered.
 */
export function normalizeGmailThreadUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const raw = url.trim();

  const threadId = extractGmailThreadId(raw);
  if (threadId) return canonicalThreadUrl(threadId);

  if (isDirkForcedGmailHref(raw)) return raw;

  if (raw.includes("mail.google.com")) {
    try {
      const u = new URL(raw);
      u.searchParams.set("authuser", CATCHER_GMAIL);
      u.pathname = "/mail/";
      u.hash = u.hash || "";
      return u.toString();
    } catch {
      return raw;
    }
  }

  if (BARE_THREAD_RE.test(raw)) return canonicalThreadUrl(raw);
  return raw;
}

/**
 * Best Dirk Gmail href for a watch/review row: known thread, else title search.
 * Always authuser=dirk@ so Tristan's default inbox is not used.
 */
export function dirkMailHref(opts: {
  gmailThreadUrl?: string | null;
  searchQuery?: string | null;
}): string {
  const thread = normalizeGmailThreadUrl(opts.gmailThreadUrl);
  if (thread) return thread;
  return gmailCatcherSearchUrl(opts.searchQuery?.trim() || "");
}
