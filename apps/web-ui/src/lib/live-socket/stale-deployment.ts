// A page loaded before a deploy calls server actions the new build no longer has; Next.js answers each with this error, and only a reload brings the page the new build's actions. Retrying it only repeats the miss, every few seconds, for as long as the tab stays open.
const MISSING_ACTION = "failed-to-find-server-action";

export function isStaleDeployment(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MISSING_ACTION);
}

/** The page's build is gone from the server: loading it again is the only way to its new actions. */
export function reloadPage(): void {
  window.location.reload();
}

/** A server action that reloads the page, once, the first time the server no longer has it; the error still reaches the caller. */
export function reloadingWhenStale<Answer>(
  action: () => Promise<Answer>,
  reload: () => void = reloadPage,
): () => Promise<Answer> {
  let reloaded = false;

  return async () => {
    try {
      return await action();
    } catch (error) {
      if (isStaleDeployment(error) && !reloaded) {
        reloaded = true;
        reload();
      }
      throw error;
    }
  };
}
