'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface Tab {
  href: string;
  label: string;
}

/** The Overview tab matches only its exact base path; every other tab also
 * matches its sub-routes (e.g. /specs/[...path] keeps Specs active). */
function isActive(pathname: string, href: string, base: string): boolean {
  if (href === base) return pathname === base;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function TabNav({ tabs, base }: { tabs: Tab[]; base: string }) {
  const pathname = usePathname();
  return (
    <nav className="tab-nav">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={isActive(pathname, tab.href, base) ? 'tab-link active' : 'tab-link'}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
