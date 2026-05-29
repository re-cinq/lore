'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Repos' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/search', label: 'Search' },
  { href: '/episodes', label: 'Episodes' },
  { href: '/graph', label: 'Graph' },
  { href: '/audit', label: 'Audit' },
  { href: '/settings', label: 'Settings' },
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
      <Link href="/onboard" className={pathname === '/onboard' ? 'active' : ''} style={{marginTop:'12px', background:'var(--bg-hover)', textAlign:'center', borderRadius:'var(--radius-sm)', color:'var(--text)', fontSize:'var(--fs-sm)'}}>
        + Add Repo
      </Link>
    </nav>
  );
}
