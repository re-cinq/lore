"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./HelpPopover.module.css";

/** The two gestures a reader expects to mean "I'm done with this": a click outside, or Escape. `mousedown` rather than `click` so the popover is gone before the click lands on whatever is underneath. */
function dismissListeners(
  ref: React.RefObject<HTMLSpanElement | null>,
  close: () => void,
) {
  const onClick = (e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      close();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
    }
  };

  return { onClick, onKey };
}

/** Listeners are attached only while open, so a page full of closed popovers costs nothing. */
function useDismissOnOutside(
  popover: { open: boolean; ref: React.RefObject<HTMLSpanElement | null> },
  close: () => void,
): void {
  const { open, ref } = popover;

  useEffect(() => {
    if (!open) {
      return;
    }
    const { onClick, onKey } = dismissListeners(ref, close);

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
    // `close` is a fresh arrow each render but only ever calls setOpen(false); including it would rebind both listeners on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ref]);
}

interface HelpTriggerProps {
  label: string;
  open: boolean;
  onToggle: () => void;
}

function HelpTrigger({ label, open, onToggle }: HelpTriggerProps) {
  return (
    <button
      type="button"
      className={styles.trigger}
      aria-label={label}
      aria-expanded={open}
      onClick={onToggle}
    >
      ?
    </button>
  );
}

function HelpPanel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.popover} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

interface HelpPopoverProps {
  label?: string;
  children: React.ReactNode;
}

export default function HelpPopover({
  label = "Help",
  children,
}: HelpPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const toggle = () => setOpen((o) => !o);

  useDismissOnOutside({ open, ref }, () => setOpen(false));

  return (
    <span className={styles.wrap} ref={ref}>
      <HelpTrigger label={label} open={open} onToggle={toggle} />
      {open && <HelpPanel label={label}>{children}</HelpPanel>}
    </span>
  );
}
