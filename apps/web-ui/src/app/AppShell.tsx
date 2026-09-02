"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Icon from "@/components/Icon";

export default function AppShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  // Close sidebar on navigation
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: collapse the sidebar in response to a route change
    setSidebarOpen(false);
  }, [pathname]);

  // Move focus into sidebar when it opens, return focus when it closes
  useEffect(() => {
    if (sidebarOpen) {
      closeButtonRef.current?.focus();

      return;
    }
    hamburgerRef.current?.focus();
  }, [sidebarOpen]);

  // Close sidebar on Escape key
  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  return (
    <div className={`app-layout${sidebarOpen ? " sidebar-open" : ""}`}>
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className="sidebar">
        <button
          ref={closeButtonRef}
          className="sidebar-close-btn"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        >
          <Icon name="close" size={16} />
        </button>
        {sidebar}
      </aside>
      <div className="main-wrapper">
        <header className="mobile-header">
          <button
            ref={hamburgerRef}
            className="hamburger-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
          >
            <span />
            <span />
            <span />
          </button>
          <span className="mobile-brand">LORE</span>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
