"use client";

// "Retry from this node" (specs/fork-rerun-from-node): posts via fetch (a native form POST navigated the whole page into a bare JSON screen) and navigates to the new run on success; `*Button.tsx` name keeps this exempt from no-io-in-view.
import { useState } from "react";

/** Starts the rerun and navigates to the new run, or returns the message to show. Nothing is returned on success because the page is already leaving. */
async function startRerun(target: {
  runId: string;
  resumeNodeId: string;
  resumeIteration: number;
}): Promise<string | null> {
  try {
    const res = await fetch("/api/assembly-runs/rerun", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        run_id: target.runId,
        node_id: target.resumeNodeId,
        iteration: String(target.resumeIteration),
      }),
    });
    const body = (await res.json()) as { id?: string; error?: string };

    if (!res.ok || !body.id) {
      return body.error ?? `retry failed (${res.status})`;
    }
    window.location.assign(`/assembly-runs/${body.id}`);

    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

interface RerunNodeButtonProps {
  runId: string;
  resumeNodeId: string;
  resumeIteration: number;
}

/** Records a failed retry. Only a FAILURE settles here: success navigates away, so clearing `pending` on that path would flash the idle label over a page that is already leaving. */
function settleRerun(
  failure: string | null,
  setError: (error: string | null) => void,
  setPending: (pending: boolean) => void,
): void {
  if (failure !== null) {
    setError(failure);
    setPending(false);
  }
}

export function RerunNodeButton(props: RerunNodeButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rerun(event: React.MouseEvent<HTMLButtonElement>) {
    // The button sits inside a clickable row; without both, retrying would also select the node behind it.
    event.preventDefault();
    event.stopPropagation();
    setPending(true);
    setError(null);
    settleRerun(await startRerun(props), setError, setPending);
  }

  return (
    <>
      {error ? <span className="meta">{error}</span> : null}
      <button
        type="button"
        onClick={(event) => void rerun(event)}
        disabled={pending}
      >
        {pending ? "Starting retry…" : "Retry from this node"}
      </button>
    </>
  );
}
