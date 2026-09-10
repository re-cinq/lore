"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./PoolDetailView.module.css";

export function PoolValueCell({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const { copied, copy } = useCopyFlash(value);
  const long = value.length > 200;
  const shown = expanded || !long ? value : `${value.substring(0, 200)}…`;

  return (
    <td className={styles.valueCell}>
      <pre className={styles.valuePre}>{shown}</pre>
      <ValueActions
        long={long}
        expanded={expanded}
        copied={copied}
        onToggle={() => setExpanded((v) => !v)}
        onCopy={() => void copy()}
      />
    </td>
  );
}

/** "Copied", for a second and a half. The timer is cleared on unmount and before each restart, so a cell copied twice in quick succession does not have the first timer switch the label off under the second. */
function useCopyFlash(value: string) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useClearTimeoutOnUnmount(copiedTimer);

  const copy = async () => {
    if (!(await copyToClipboard(value))) {
      return;
    }
    setCopied(true);
    clearPendingTimer(copiedTimer);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  return { copied, copy };
}

type TimerRef = { current: ReturnType<typeof setTimeout> | null };

function useClearTimeoutOnUnmount(timer: TimerRef) {
  useEffect(() => () => clearPendingTimer(timer), [timer]);
}

function clearPendingTimer(timer: TimerRef) {
  if (timer.current) {
    clearTimeout(timer.current);
  }
}

/** Whether the value reached the clipboard. The API is unavailable outside a secure context, and a failed copy says nothing rather than raising — the value is still on screen to select by hand. */
async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);

    return true;
  } catch {
    return false;
  }
}

interface ValueActionsProps {
  long: boolean;
  expanded: boolean;
  copied: boolean;
  onToggle: () => void;
  onCopy: () => void;
}

function ValueActions(props: ValueActionsProps) {
  const { long, expanded, copied, onToggle, onCopy } = props;

  return (
    <div className={styles.valueActions}>
      {long && (
        <ValueButton
          label={expanded ? "Show less" : "Show more"}
          onClick={onToggle}
        />
      )}
      <ValueButton label={copied ? "Copied" : "Copy"} onClick={onCopy} />
    </div>
  );
}

/** One of the cell's two controls. Both are label-only, and the label is what changes when the state does — "Copy" becoming "Copied" is the whole feedback. */
function ValueButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn-secondary ${styles.valueAction}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
