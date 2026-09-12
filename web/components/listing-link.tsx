"use client";

import type { ReactNode } from "react";

import {
  LISTING_NEW_TAB_REL,
  listingOpenHref,
  openListingUrl,
} from "@/lib/listing-url";

/** `<a target="_blank">` plus `window.open` so matrix `;` URLs stay whole. */
export function ListingLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const url = listingOpenHref(href);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel={LISTING_NEW_TAB_REL}
      className={className}
      onClick={(event) => openListingUrl(url, event)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </a>
  );
}
