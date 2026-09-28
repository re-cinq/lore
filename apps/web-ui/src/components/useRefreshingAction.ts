"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ServerAction = () => Promise<{ error?: string }>;

/** Runs a server action, keeps its refusal to show, and reloads the page onto what it changed; `onSettled` hears of the answer before either. `router.refresh()` is called inside the transition on purpose — Next.js keeps `pending` true until the refreshed RSC payload actually commits, not just until the action's own fetch resolves. `run` returns a promise that settles once that transition finishes, so a caller (PendingActionButton) can await it directly. */
export function useRefreshingAction(
  action: ServerAction,
  onSettled?: () => void,
) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  // eslint-disable-next-line no-restricted-syntax -- the legitimate shared holder: router.refresh() must run inside this transition so `pending` covers the refresh, not just the action's fetch
  const [pending, startTransition] = useTransition();

  function run(): Promise<void> {
    return new Promise((resolve) => {
      startTransition(async () => {
        await settle(action, onSettled, setError, router);
        resolve();
      });
    });
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
