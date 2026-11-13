"use client";

import ActionForm from "@/components/ActionForm";

/** The webhook-setup form, kept as its own component for existing callers. Surfaces errors returned by the action. */
export default function SetupWebhookButton({
  action,
  text,
}: {
  action: () => Promise<{ error?: string } | void>;
  text: string;
}) {
  return (
    <ActionForm action={action} pendingLabel="setting up…">
      {text}
    </ActionForm>
  );
}
