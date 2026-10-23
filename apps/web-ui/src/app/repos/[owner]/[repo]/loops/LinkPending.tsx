"use client";

import { useLinkStatus } from "next/link";
import styles from "./LoopPicker.module.scss";

/** Inside a pill's Link: a spinner from the click until the page under it arrives, so a slow loop never reads as a dead button. */
export default function LinkPending() {
  const { pending } = useLinkStatus();

  return <PendingMark pending={pending} />;
}

/** The mark itself, pure so it can be shown without a navigation in flight. */
export function PendingMark({ pending }: { pending: boolean }) {
  if (!pending) {
    return null;
  }

  return (
    <span
      className={`chip-spinner ${styles.pending}`}
      role="status"
      aria-label="Loading"
      data-testid="pill-pending"
    />
  );
}
