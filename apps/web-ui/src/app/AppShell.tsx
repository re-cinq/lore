"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Icon from "@/components/Icon";

type ButtonRef = React.RefObject<HTMLButtonElement | null>;

interface DrawerState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  closeButtonRef: ButtonRef;
  hamburgerRef: ButtonRef;
}

interface AppShellProps {
  /** The nav itself — passed in rather than imported, so the shell stays a layout. */
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function AppShell({ sidebar, children }: AppShellProps) {
  const drawer = useSidebarDrawer();
  const openClass = drawer.sidebarOpen ? " sidebar-open" : "";

  return (
    <div className={`app-layout${openClass}`}>
      <SidebarDrawer drawer={drawer} sidebar={sidebar} />
      <MainArea drawer={drawer}>{children}</MainArea>
    </div>
  );
}

/** The mobile drawer's behaviour: it closes on navigation, takes focus when it opens and hands it back to the hamburger when it closes, and closes on Escape. Together these are what make it usable without a mouse. */
function useSidebarDrawer(): DrawerState {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  const drawer = { sidebarOpen, setSidebarOpen, closeButtonRef, hamburgerRef };

  useCloseOnNavigate(setSidebarOpen);
  useFocusHandoff(drawer);
  useEscapeToClose(drawer);

  return drawer;
}

interface SidebarDrawerProps {
  drawer: DrawerState;
  sidebar: React.ReactNode;
}

/** The nav in its narrow-screen form: an overlay that exists only while open, plus the panel itself. */
function SidebarDrawer({ drawer, sidebar }: SidebarDrawerProps) {
  const close = () => drawer.setSidebarOpen(false);

  return (
    <>
      {drawer.sidebarOpen && (
        <div className="sidebar-overlay" onClick={close} aria-hidden="true" />
      )}
      <aside className="sidebar">
        <CloseButton buttonRef={drawer.closeButtonRef} onClose={close} />
        {sidebar}
      </aside>
    </>
  );
}

interface MainAreaProps {
  drawer: DrawerState;
  children: React.ReactNode;
}

/** Everything that is not the nav: the mobile bar above the page, and the page. */
function MainArea({ drawer, children }: MainAreaProps) {
  return (
    <div className="main-wrapper">
      <MobileHeader
        buttonRef={drawer.hamburgerRef}
        sidebarOpen={drawer.sidebarOpen}
        onOpen={() => drawer.setSidebarOpen(true)}
      />
      <main className="main-content">{children}</main>
    </div>
  );
}

/** A route change is a dismissal: the drawer covers the page it just navigated to. */
function useCloseOnNavigate(setSidebarOpen: (open: boolean) => void) {
  const pathname = usePathname();

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);
}

/** Focus follows the drawer: into its close button on open, back to the hamburger on close, so a keyboard reader is never stranded. */
function useFocusHandoff(drawer: Omit<DrawerState, "setSidebarOpen">) {
  const { sidebarOpen, closeButtonRef, hamburgerRef } = drawer;

  useEffect(() => {
    if (sidebarOpen) {
      closeButtonRef.current?.focus();

      return;
    }
    hamburgerRef.current?.focus();
  }, [sidebarOpen, closeButtonRef, hamburgerRef]);
}

/** Escape closes the drawer — the escape hatch every overlay owes its reader. */
function useEscapeToClose(
  drawer: Pick<DrawerState, "sidebarOpen" | "setSidebarOpen">,
) {
  const { sidebarOpen, setSidebarOpen } = drawer;

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
  }, [sidebarOpen, setSidebarOpen]);
}

/** Dismisses the drawer. Holds the ref that focus returns to when the drawer opens, so a keyboard reader lands on the way out rather than at the top of the nav. */
function CloseButton({
  buttonRef,
  onClose,
}: {
  buttonRef: ButtonRef;
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

interface MobileHeaderProps {
  buttonRef: ButtonRef;
  sidebarOpen: boolean;
  onOpen: () => void;
}

/** The narrow-screen bar: the only way to reach the nav once the sidebar is a drawer. `aria-expanded` tracks the drawer so the control reports its own state rather than just its label. */
function MobileHeader({ buttonRef, sidebarOpen, onOpen }: MobileHeaderProps) {
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
