"use client";

// "Retry from this node" (specs/fork-rerun-from-node): posts via fetch (a native form POST navigated the whole page into a bare JSON screen) and navigates to the new run on success; `*Button.tsx` name keeps this exempt from no-io-in-view.
import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";

interface RerunNodeButtonProps {
  runId: string;
  resumeNodeId: string;
  resumeIteration: number;
}

export function RerunNodeButton(props: RerunNodeButtonProps) {
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {error ? <span className="meta">{error}</span> : null}
      <PendingActionButton
        action={() => rerun(props, setError)}
        text="Retry from this node"
        pendingText="Starting retry…"
        guardRow
        className=""
      />
    </>
  );
}

/** Starts the rerun and navigates to the new run, or shows the message inline. On success the promise is left unsettled — the page is already leaving, so the button must not flip back to its ready label first. */
async function rerun(
  target: RerunNodeButtonProps,
  setError: (error: string | null) => void,
): Promise<void> {
  setError(null);

  try {
    const res = await postRerun(target);
    const body = (await res.json()) as { id?: string; error?: string };

    if (!res.ok || !body.id) {
      setError(body.error ?? `retry failed (${res.status})`);

      return;
    }
    window.location.assign(`/assembly-runs/${body.id}`);
    await new Promise<void>(() => {});
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  }
}

function postRerun(target: RerunNodeButtonProps): Promise<Response> {
  return fetch("/api/assembly-runs/rerun", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      run_id: target.runId,
      node_id: target.resumeNodeId,
      iteration: String(target.resumeIteration),
    }),
  });
}
