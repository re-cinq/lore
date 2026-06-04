'use client';

import Link, { useLinkStatus } from 'next/link';

function PendingDot() {
  const { pending } = useLinkStatus();
  return pending ? <span className="chip-spinner" aria-hidden="true" /> : null;
}

export interface FilterChipProps {
  href: string;
  active: boolean;
  children: React.ReactNode;
}

/**
 * A content-type filter chip. Wraps next/link so navigation is client-side, and
 * shows an inline spinner via useLinkStatus while the navigation it triggered is
 * in flight — the loading feedback for the filter row.
 */
export default function FilterChip({ href, active, children }: FilterChipProps) {
  return (
    <Link href={href} className={active ? 'active' : ''} prefetch={false}>
      {children}
      <PendingDot />
    </Link>
  );
}
