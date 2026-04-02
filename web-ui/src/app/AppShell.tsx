'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import SidebarNav from './SidebarNav';
import UserMenu from './UserMenu';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <div className="app-layout">
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/logo.svg" alt="Lore" width={28} height={28} />
          LORE
          <button
            className="sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <SidebarNav />
        <UserMenu />
      </aside>

      <div className="main-wrapper">
        <header className="mobile-header">
          <button
            className="hamburger"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="mobile-brand">
            <img src="/logo.svg" alt="Lore" width={22} height={22} />
            LORE
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
