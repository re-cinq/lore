"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

/** The webhook-setup form, kept as its own component for existing callers. Surfaces errors returned by the action. */
export default function SetupWebhookButton({
  action,
  text,
}: {
  action: () => Promise<{ error?: string } | void>;
  text: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(undefined);

    try {
      const result = await action();

      if (result && typeof result === "object" && result.error) {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p>{error}</p>}
      <SubmitButton pending={pending} pendingLabel="setting up…">
        {text}
      </SubmitButton>
    </form>
  );
}
