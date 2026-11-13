"use client";

import ActionForm from "@/components/ActionForm";

/** The re-onboarding form, kept as its own component for existing callers. Surfaces errors returned by the action. */
export default function ReonboardButton({
  action,
  text,
}: {
  action: () => Promise<{ error?: string } | void>;
  text: string;
}) {
  return (
    <ActionForm action={action} pendingLabel="starting the run…">
      {text}
    </ActionForm>
  );
}
