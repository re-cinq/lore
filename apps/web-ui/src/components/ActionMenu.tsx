"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import styles from "./ActionMenu.module.scss";

interface ActionMenuProps {
  label: string;
  children: ReactNode;
}

/** A button of three dots that opens a small panel of actions. A confirm popup an action opens lives inside the panel, so presses and Escape that land in it leave the menu open. */
export default function ActionMenu({ label, children }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <MenuTrigger
        label={label}
        open={open}
        onToggle={() => setOpen((wasOpen) => !wasOpen)}
      />
      {open && (
        <MenuPanel wrapRef={wrapRef} close={close}>
          {children}
        </MenuPanel>
      )}
    </div>
  );
}

interface MenuTriggerProps {
  label: string;
  open: boolean;
  onToggle: () => void;
}

function MenuTrigger({ label, open, onToggle }: MenuTriggerProps) {
  return (
    <button
      type="button"
      className={styles.trigger}
      aria-haspopup="true"
      aria-expanded={open}
      aria-label={label}
      onClick={onToggle}
    >
      <ThreeDots />
    </button>
  );
}

function ThreeDots() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="13" cy="8" r="1.5" fill="currentColor" />
    </svg>
  );
}

interface MenuPanelProps {
  wrapRef: RefObject<HTMLDivElement | null>;
  close: () => void;
  children: ReactNode;
}

/** Mounted only while the menu is open, so its listeners exist only then. */
function MenuPanel({ wrapRef, close, children }: MenuPanelProps) {
  useDismissOnOutsideOrEscape(wrapRef, close);

  return <div className={styles.panel}>{children}</div>;
}

function useDismissOnOutsideOrEscape(
  wrapRef: RefObject<HTMLDivElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    const { onPress, onKey } = dismissListeners(wrapRef, close);

    document.addEventListener("mousedown", onPress);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [wrapRef, close]);
}

/** `mousedown` rather than `click`, so the panel is gone before the click lands on what is underneath. */
function dismissListeners(
  wrapRef: RefObject<HTMLDivElement | null>,
  close: () => void,
) {
  const onPress = (event: MouseEvent) => {
    const outside = !wrapRef.current?.contains(event.target as Node);

    if (outside && !isInsideDialog(event.target)) {
      close();
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !isInsideDialog(event.target)) {
      close();
    }
  };

  return { onPress, onKey };
}

function isInsideDialog(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("dialog, [role='dialog']") !== null
  );
}
