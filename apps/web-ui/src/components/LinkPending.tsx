"use client";

import { useLinkStatus } from "next/link";

interface MarkProps {
  /** The spinner's accessible name, saying what is on its way. */
  label?: string;
  className?: string;
}

/** Inside a Link: a spinner from the click until the page under it arrives, so a slow page never reads as a dead link. */
export default function LinkPending(props: MarkProps) {
  const { pending } = useLinkStatus();

  return <PendingMark pending={pending} {...props} />;
}

/** The mark itself, pure so it can be shown without a navigation in flight. `data-pending` lets the Link's own styles react, since a child cannot set its Link's attributes. */
export function PendingMark({
  pending,
  label = "Loading",
  className,
}: MarkProps & { pending: boolean }) {
  if (!pending) {
    return null;
  }

  return (
    <span
      className={className ? `chip-spinner ${className}` : "chip-spinner"}
      role="status"
      aria-label={label}
      data-pending
    />
  );
}
