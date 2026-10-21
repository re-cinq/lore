// A run's start items, by name — the floor's own record of what a line was started with (a repo, a task id, a pull request url, ...).
import type { RunView } from "@re-cinq/floor-client";

export function startValueOf(run: RunView, name: string): string | undefined {
  const startItems: Partial<RunView["startItems"]> = run.startItems;

  return startItems[name]?.ref;
}
