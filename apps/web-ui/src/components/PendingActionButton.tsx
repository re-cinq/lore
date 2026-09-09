"use client";

import { useTransition } from "react";
import styles from "./ReonboardButton.module.css";

interface PendingActionButtonProps {
  action: () => Promise<void>;
  text: string;
  /** What the button says while the action runs — the only thing that differs between its instances. */
  pendingText: string;
}

/** A server-action button that disables itself for the duration and says what it is doing. */
export default function PendingActionButton({
  action,
  text,
  pendingText,
}: PendingActionButtonProps) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => action())}
      className={styles.button}
    >
      {pending ? pendingText : text}
    </button>
  );
}
