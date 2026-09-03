import type { AssemblyRun } from "@/lib/assembly-runs";
import { TriggerReviewButton } from "./TriggerReviewButton";

// A code-review run with a PR gets the manual "Trigger review" button; other runs offer nothing.
export function AssemblyRunOptions({ run }: { run: AssemblyRun }) {
  if (run.blueprintName !== "code-review" || run.prNumber === null) {
    return null;
  }

  return <TriggerReviewButton repo={run.repo} prNumber={run.prNumber} />;
}
