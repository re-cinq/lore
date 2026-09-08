"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Icon from "@/components/Icon";

/** The mobile drawer's behaviour: it closes on navigation, takes focus when it opens and hands it back to the hamburger when it closes, and closes on Escape. Together these are what make it usable without a mouse. */
function useSidebarDrawer() {
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

  return { sidebarOpen, setSidebarOpen, closeButtonRef, hamburgerRef };
}

/** Dismisses the drawer. Holds the ref that focus returns to when the drawer opens, so a keyboard reader lands on the way out rather than at the top of the nav. */
function CloseButton({
  buttonRef,
  onClose,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      className="sidebar-close-btn"
      onClick={onClose}
      aria-label="Close menu"
    >
      <Icon name="close" size={16} />
    </button>
  );
}

/** The narrow-screen bar: the only way to reach the nav once the sidebar is a drawer. `aria-expanded` tracks the drawer so the control reports its own state rather than just its label. */
function MobileHeader({
  buttonRef,
  sidebarOpen,
  onOpen,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  sidebarOpen: boolean;
  onOpen: () => void;
}) {
  return (
    <header className="mobile-header">
      <button
        ref={buttonRef}
        className="hamburger-btn"
        onClick={onOpen}
        aria-label="Open menu"
        aria-expanded={sidebarOpen}
      >
        <span />
        <span />
        <span />
      </button>
      <span className="mobile-brand">LORE</span>
    </header>
  );
}

interface AppShellProps {
  /** The nav itself — passed in rather than imported, so the shell stays a layout. */
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function AppShell({ sidebar, children }: AppShellProps) {
  const { sidebarOpen, setSidebarOpen, closeButtonRef, hamburgerRef } =
    useSidebarDrawer();

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
        <CloseButton
          buttonRef={closeButtonRef}
          onClose={() => setSidebarOpen(false)}
        />
        {sidebar}
      </aside>
      <div className="main-wrapper">
        <MobileHeader
          buttonRef={hamburgerRef}
          sidebarOpen={sidebarOpen}
          onOpen={() => setSidebarOpen(true)}
        />
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
