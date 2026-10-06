"use client";

import { SubmitButton } from "@/components/SubmitButton";

// Native full-page POST to the upgrade proxy, which redirects to the run it started.
export function UpgradeAssemblyLineButton({ runId }: { runId: string }) {
  return (
    <form
      action={`/api/assembly-runs/${encodeURIComponent(runId)}/upgrade`}
      method="POST"
    >
      <SubmitButton pendingLabel="Upgrading…">
        Upgrade assembly line
      </SubmitButton>
    </form>
  );
}
