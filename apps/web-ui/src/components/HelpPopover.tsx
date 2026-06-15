'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './HelpPopover.module.css';

export default function HelpPopover({
  label = 'Help',
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
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
