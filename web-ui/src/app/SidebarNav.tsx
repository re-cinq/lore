'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Agents' },
  { href: '/search', label: 'Search' },
  { href: '/audit', label: 'Audit' },
  { href: '/pools', label: 'Pools' },
  { href: '/context', label: 'Context' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/specs', label: 'Specs' },
  { href: '/gaps', label: 'Gaps' },
  { href: '/pipeline', label: 'Pipeline' },
];

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav>
      {links.map(({ href, label }) => {
        const isActive =
          href === '/'
            ? pathname === '/'
            : pathname === href || pathname.startsWith(href + '/');
        return (
          <Link key={href} href={href} className={isActive ? 'active' : ''}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
