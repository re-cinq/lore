"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ServerAction = () => Promise<{ error?: string }>;

/** Runs a server action, keeps its refusal to show, and reloads the page onto what it changed; `onSettled` hears of the answer before either. `run` returns the promise itself so a caller (PendingActionButton) can await it directly. */
export function useRefreshingAction(
  action: ServerAction,
  onSettled?: () => void,
) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function run(): Promise<void> {
    setPending(true);

    try {
      await settle(action, onSettled, setError, router);
    } finally {
      setPending(false);
    }
  }

  return { error, pending, run };
}

async function settle(
  action: ServerAction,
  onSettled: (() => void) | undefined,
  setError: (error: string | undefined) => void,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  const result = await action();

  onSettled?.();
  setError(result.error);

  if (!result.error) {
    router.refresh();
  }
}
