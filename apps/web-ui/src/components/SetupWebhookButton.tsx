"use client";

import PendingActionButton from "@/components/PendingActionButton";

/** The webhook-setup instance, kept as its own component for existing callers. */
export default function SetupWebhookButton(props: {
  action: () => Promise<void>;
  text: string;
}) {
  return <PendingActionButton {...props} pendingText="setting up…" />;
}
