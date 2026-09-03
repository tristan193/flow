"use client";

import { CIM_NEW_TAB_REL, openCimInNewTab } from "@/lib/cim-new-tab";

/** `<a target="_blank">` plus `window.open` so /next never navigates away. */
export function CimNewTabLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel={CIM_NEW_TAB_REL}
      className={className}
      onClick={(event) => openCimInNewTab(href, event)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </a>
  );
}
