'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Repos' },
  { href: '/search', label: 'Search' },
  { href: '/audit', label: 'Audit' },
  { href: '/pools', label: 'Pools' },
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
      <Link href="/onboard" className={pathname === '/onboard' ? 'active' : ''} style={{marginTop:'12px', background:'#1e293b', textAlign:'center', borderRadius:'6px', color:'#e2e8f0', fontSize:'13px'}}>
        + Add Repo
      </Link>
    </nav>
  );
}
