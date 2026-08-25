/** Catcher inbox — harvest + pursuit mail lives here, not Tristan's personal Gmail. */
export const CATCHER_GMAIL = "dirk@tullyinvesting.com";

/** Deep-link a Gmail thread in Dirk's account (authuser), not browser u/0. */
export function gmailCatcherThreadUrl(threadId: string): string {
  const id = threadId.trim();
  if (!id) return "";
  const auth = encodeURIComponent(CATCHER_GMAIL);
  return `https://mail.google.com/mail/?authuser=${auth}#all/${id}`;
}

/** Search Dirk's mailbox (authuser) — used when we have a title but no thread yet. */
export function gmailCatcherSearchUrl(query: string): string {
  const q = query.trim();
  const auth = encodeURIComponent(CATCHER_GMAIL);
  if (!q) return `https://mail.google.com/mail/?authuser=${auth}#inbox`;
  return `https://mail.google.com/mail/?authuser=${auth}#search/${encodeURIComponent(q)}`;
}

/**
 * Rewrite legacy `/mail/u/0/#all/…` links (opens Tristan's default account)
 * to Dirk authuser links. Pass-through if already authuser-scoped or unknown.
 */
export function normalizeGmailThreadUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const raw = url.trim();
  if (/authuser=dirk(%40|@)tullyinvesting\.com/i.test(raw)) return raw;

  const hashId = raw.match(/#(all|inbox|sent|search)\/([a-zA-Z0-9]+)/i);
  if (hashId?.[2]) return gmailCatcherThreadUrl(hashId[2]);

  if (raw.includes("mail.google.com") && !/authuser=/i.test(raw)) {
    try {
      const u = new URL(raw);
      u.searchParams.set("authuser", CATCHER_GMAIL);
      // Drop /u/N so authuser wins instead of the browser's first account.
      u.pathname = "/mail/";
      return u.toString();
    } catch {
      return raw;
    }
  }

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
