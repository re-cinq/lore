import type { AssemblyRun } from "@/lib/assembly-runs";
import { TriggerReviewButton } from "./TriggerReviewButton";
import { UpgradeAssemblyLineButton } from "./UpgradeAssemblyLineButton";

// A code-review run with a PR gets the manual "Trigger review" button; other runs offer nothing.
export function AssemblyRunOptions({
  run,
  upgradeAvailable = false,
}: {
  run: AssemblyRun;
  upgradeAvailable?: boolean;
}) {
  const review = run.blueprintName === "code-review" && run.prNumber !== null;

  if (!review && !upgradeAvailable) return null;

  return (
    <>
      {review ? (
        <TriggerReviewButton repo={run.repo} prNumber={run.prNumber} />
      ) : null}
      {upgradeAvailable ? <UpgradeAssemblyLineButton runId={run.id} /> : null}
    </>
  );
}
