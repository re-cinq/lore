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
    const result = await action();

    onSettled?.();
    setError(result.error);

    if (!result.error) {
      router.refresh();
    }
    setPending(false);
  }

  return { error, pending, run };
}
