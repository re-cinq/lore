"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ServerAction = () => Promise<{ error?: string }>;

/** Runs a server action in a transition, keeps its refusal to show, and reloads the page onto what it changed; `onSettled` hears of the answer before either. */
export function useRefreshingAction(
  action: ServerAction,
  onSettled?: () => void,
) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      const result = await action();

      onSettled?.();
      setError(result.error);

      if (!result.error) {
        router.refresh();
      }
    });

  return { error, pending, run };
}
