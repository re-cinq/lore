"use client";

// A value taller than a card should be (run-viz FR4.4l): past 15 lines it starts folded to that height, and a toggle shows it all.
import { useState, type ReactNode } from "react";
import styles from "./ItemValue.module.css";

const FOLD_LINES = 15;

export default function FoldedValue({
  lines,
  children,
}: {
  lines: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  if (lines <= FOLD_LINES) {
    return <div>{children}</div>;
  }

  return (
    <>
      <div className={styles.folded} data-folded={String(!open)}>
        {children}
      </div>
      <FoldToggle open={open} lines={lines} onToggle={() => setOpen(!open)} />
    </>
  );
}

function FoldToggle(props: {
  open: boolean;
  lines: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.foldToggle}
      onClick={props.onToggle}
    >
      {props.open ? "Show less" : `Show all ${props.lines} lines`}
    </button>
  );
}
