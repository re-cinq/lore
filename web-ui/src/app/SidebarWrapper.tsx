'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import SidebarNav from './SidebarNav';
import UserMenu from './UserMenu';

export default function SidebarWrapper() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && sidebarRef.current) {
      const firstFocusable = sidebarRef.current.querySelector<HTMLElement>(
        'a, button, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    }
  }, [isOpen]);

  return (
    <>
      <header className="mobile-header">
        <button
          className="hamburger-btn"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="Toggle menu"
          aria-expanded={isOpen}
          aria-controls="sidebar"
        >
          <span />
          <span />
          <span />
        </button>
        <div className="mobile-brand">
          <img src="/logo.svg" alt="Lore" width={24} height={24} />
          LORE
        </div>
      </header>

      {isOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="sidebar"
        className={`sidebar${isOpen ? ' sidebar-open' : ''}`}
        ref={sidebarRef}
        aria-label="Main navigation"
      >
        <div className="sidebar-brand">
          <img src="/logo.svg" alt="Lore" width={28} height={28} />
          LORE
          <button
            className="sidebar-close-btn"
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <SidebarNav />
        <UserMenu />
      </aside>
    </>
  );
}
