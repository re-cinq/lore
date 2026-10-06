import type { AssemblyRun } from "@/lib/assembly-runs";
import { TriggerReviewButton } from "./TriggerReviewButton";
import { UpgradeAssemblyLineButton } from "./UpgradeAssemblyLineButton";

// A code-review run with a PR gets the manual "Trigger review" button; a run whose assembly line has a newer version gets the upgrade action; a run with neither offers nothing.
export function AssemblyRunOptions({
  run,
  upgradeAvailable = false,
}: {
  run: AssemblyRun;
  upgradeAvailable?: boolean;
}) {
  const prNumber = reviewPrNumber(run);

  if (prNumber === null && !upgradeAvailable) {
    return null;
  }

  return (
    <>
      {prNumber === null ? null : (
        <TriggerReviewButton repo={run.repo} prNumber={prNumber} />
      )}
      {upgradeAvailable ? <UpgradeAssemblyLineButton runId={run.id} /> : null}
    </>
  );
}

// The PR a manual "Trigger review" would re-review, or null for any other run.
function reviewPrNumber(run: AssemblyRun): number | null {
  return run.blueprintName === "code-review" ? run.prNumber : null;
}
