"use client";

// "Upgrade assembly line": starts the newest version of this run's line with this run's inputs, then goes to the run it started. `*Button.tsx` keeps this exempt from no-io-in-view.
import { useState } from "react";
import { useRouter } from "next/navigation";
import PendingActionButton from "@/components/PendingActionButton";
import type { components } from "@/lib/api/schema";

type UpgradeAnswer = Partial<components["schemas"]["AssemblyRunUpgraded"]> & {
  error?: string;
};

export function UpgradeAssemblyLineButton({ runId }: { runId: string }) {
  const { error, upgrade } = useUpgrade(runId);

  return (
    <>
      <PendingActionButton
        action={upgrade}
        text="Upgrade assembly line"
        pendingText="Upgrading…"
        className=""
      />
      {error ? <span className="meta">{error}</span> : null}
    </>
  );
}

/** The ask and the navigation it ends in: the new run is a run of its own, so the page it opens is the answer, and a refusal stays beside the button instead of replacing the page. */
function useUpgrade(runId: string) {
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function upgrade(): Promise<void> {
    const answer = await askToUpgrade(runId);

    setError(answer.error);

    if (answer.run_id) {
      router.push(`/assembly-runs/${encodeURIComponent(answer.run_id)}`);
    }
  }

  return { error, upgrade };
}

async function askToUpgrade(runId: string): Promise<UpgradeAnswer> {
  const res = await fetch(
    `/api/assembly-runs/${encodeURIComponent(runId)}/upgrade`,
    { method: "POST", signal: AbortSignal.timeout(30_000) },
  );
  const answer = (await res.json()) as UpgradeAnswer;

  return res.ok
    ? answer
    : { error: answer.error ?? `upgrade failed (${res.status})` };
}
