"use client";

import PendingActionButton from "@/components/PendingActionButton";

/** The re-onboarding instance, kept as its own component for existing callers. */
export default function ReonboardButton(props: {
  action: () => Promise<void>;
  text: string;
}) {
  return <PendingActionButton {...props} pendingText="opening PR…" />;
}
