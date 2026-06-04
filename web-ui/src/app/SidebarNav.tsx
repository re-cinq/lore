'use client';

import { usePathname } from 'next/navigation';
import NavLink from '@/components/NavLink';
import { isNavActive } from '@/lib/nav-active';

const links = [
  { href: '/', label: 'Repos' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/spend', label: 'Spend' },
  { href: '/search', label: 'Search' },
  { href: '/episodes', label: 'Episodes' },
  { href: '/graph', label: 'Graph' },
  { href: '/agents', label: 'Agents' },
  { href: '/audit', label: 'Audit' },
  { href: '/settings', label: 'Settings' },
];

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav>
      {links.map(({ href, label }) => (
        <NavLink key={href} href={href} label={label} active={isNavActive(pathname, href, '/')} />
      ))}
      <NavLink
        href="/onboard"
        label="+ Add Repo"
        active={isNavActive(pathname, '/onboard', '/')}
        style={{ marginTop: '12px', background: 'var(--bg-hover)', textAlign: 'center', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 'var(--fs-sm)' }}
      />
    </nav>
  );
}
