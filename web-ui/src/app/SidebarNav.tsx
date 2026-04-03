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
      <Link href="/onboard" className={pathname === '/onboard' ? 'active' : ''} style={{marginTop:'12px', background:'#1e293b', textAlign:'center', borderRadius:'6px', color:'#e2e8f0', fontSize:'13px'}}>
        + Add Repo
      </Link>
    </nav>
  );
}
