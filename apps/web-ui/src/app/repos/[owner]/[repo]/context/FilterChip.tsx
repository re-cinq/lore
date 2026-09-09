"use client";

import Link, { useLinkStatus } from "next/link";

function PendingDot() {
  const { pending } = useLinkStatus();

  return pending ? <span className="chip-spinner" aria-hidden="true" /> : null;
}

export interface FilterChipProps {
  href: string;
  active: boolean;
  children: React.ReactNode;
}

/** Content-type chip with inline spinner showing navigation-in-flight status. */
export default function FilterChip({
  href,
  active,
  children,
}: FilterChipProps) {
  return (
    <Link href={href} className={active ? "active" : ""} prefetch={false}>
      {children}
      <PendingDot />
    </Link>
  );
}
