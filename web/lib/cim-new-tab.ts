/**
 * Force CIM links into a new browsing context.
 *
 * Same-origin `/cim/TLY-XXX` is an App Router page that `redirect()`s to the
 * stamped Drive file. A same-tab click (or a Next.js client navigation that
 * ignores `target="_blank"`) replaces `/next` with that redirect. Always open
 * via `window.open` on an unmodified primary click.
 */

export const CIM_NEW_TAB_REL = "noopener noreferrer";
export const CIM_NEW_TAB_FEATURES = "noopener,noreferrer";

export function isUnmodifiedPrimaryClick(event: {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function openCimInNewTab(
  url: string,
  event?: {
    preventDefault(): void;
    stopPropagation(): void;
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
): void {
  if (event && !isUnmodifiedPrimaryClick(event)) return;
  event?.preventDefault();
  event?.stopPropagation();
  window.open(url, "_blank", CIM_NEW_TAB_FEATURES);
}
