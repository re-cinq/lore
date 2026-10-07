"use client";

// "Run this station": asks the floor to run the selected node again in this run, open or finished, then re-reads the page so a reopened run is followed live. `*Button.tsx` keeps this exempt from no-io-in-view.
import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";
import { useRefreshingAction } from "@/components/useRefreshingAction";
import type { components } from "@/lib/api/schema";

type RunAnswer = Partial<components["schemas"]["NodeRunAsked"]> & {
  error?: string;
};

const NOT_STARTED_YET = "Asked the floor; it has not started yet";

interface RunNodeButtonProps {
  runId: string;
  nodeId: string;
}

/** It sits inside the inspector card's <summary>, so the click is kept from toggling the card (`guardRow`). */
export function RunNodeButton(props: RunNodeButtonProps) {
  const { note, pending, run } = useRunNode(props);

  return (
    <>
      {note ? <span className="meta">{note}</span> : null}
      <PendingActionButton
        action={run}
        text="Run this station"
        pendingText="Asking the floor…"
        pending={pending}
        guardRow
        className="btn-secondary"
      />
    </>
  );
}

/** The ask, the page refresh it is followed by, and the one line to show beside the button: the refusal, or that the floor has not started it yet. */
function useRunNode({ runId, nodeId }: RunNodeButtonProps) {
  const [notStarted, setNotStarted] = useState<string>();
  const { error, pending, run } = useRefreshingAction(async () => {
    const answer = await askToRun(runId, nodeId);

    setNotStarted(answer.pending ? NOT_STARTED_YET : undefined);

    return answer;
  });

  return { note: error ?? notStarted, pending, run };
}

async function askToRun(runId: string, nodeId: string): Promise<RunAnswer> {
  const res = await fetch(
    `/api/assembly-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/run`,
    { method: "POST", signal: AbortSignal.timeout(30_000) },
  );
  const answer = (await res.json()) as RunAnswer;

  return res.ok
    ? answer
    : { error: answer.error ?? `run failed (${res.status})` };
}
