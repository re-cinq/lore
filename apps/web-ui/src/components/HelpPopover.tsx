"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./HelpPopover.module.css";

/** Closes the popover on a click outside it or on Escape — the two gestures a reader expects to mean "I'm done with this". Listeners are attached only while open, so a page full of closed popovers costs nothing; `mousedown` rather than `click` so the popover is gone before the click lands on whatever is underneath. */
function useDismissOnOutside(
  open: boolean,
  ref: React.RefObject<HTMLSpanElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }
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

export default function HelpPopover({
  label = "Help",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useDismissOnOutside(open, ref, () => setOpen(false));

  return (
    <span className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </span>
  );
}
