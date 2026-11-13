"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

type Action = () => Promise<{ error?: string } | void>;

type Props = {
  action: Action;
  pendingLabel: string;
  children: React.ReactNode;
};

export default function ActionForm({ action, pendingLabel, children }: Props) {
  const { pending, error, onSubmit } = useActionForm(action);

  return (
    <form onSubmit={onSubmit}>
      {error && <p role="alert">{error}</p>}
      <SubmitButton className="" pending={pending} pendingLabel={pendingLabel}>
        {children}
      </SubmitButton>
    </form>
  );
}

function useActionForm(action: Action) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const handleSubmit = async (e: React.FormEvent) => {
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
  };
  const onSubmit = (e: React.FormEvent) => void handleSubmit(e);

  return { pending, error, onSubmit };
}
