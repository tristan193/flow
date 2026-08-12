/** Catcher inbox — harvest + pursuit mail lives here, not Tristan's personal Gmail. */
export const CATCHER_GMAIL = "dirk@tullyinvesting.com";

/** Deep-link a Gmail thread in Dirk's account (authuser), not browser u/0. */
export function gmailCatcherThreadUrl(threadId: string): string {
  const id = threadId.trim();
  if (!id) return "";
  const auth = encodeURIComponent(CATCHER_GMAIL);
  return `https://mail.google.com/mail/?authuser=${auth}#all/${id}`;
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
