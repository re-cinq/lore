import type { AssemblyRun } from "@/lib/assembly-runs";
import { TriggerReviewButton } from "./TriggerReviewButton";

/**
 * The actions a run offers, decided from the run itself: a code-review run
 * with a PR gets the manual "Trigger review" button; other runs offer nothing.
 */
export function AssemblyRunOptions({ run }: { run: AssemblyRun }) {
  if (run.blueprintName !== "code-review" || run.prNumber === null) {
    return null;
  }

  return <TriggerReviewButton repo={run.repo} prNumber={run.prNumber} />;
}
