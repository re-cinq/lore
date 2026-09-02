"use client";

/**
 * "Retry from this node" — fork-and-rerun of a terminal run from the inspected
 * node (specs/fork-rerun-from-node). Lives in the node card's HEADER row, so
 * the click must preventDefault: inside a <summary>, the default click also
 * toggles the fold. Posts to the /api/assembly-runs/rerun proxy over fetch —
 * a native form POST navigated the whole page to the API route, which turned
 * any error into a bare JSON screen — and navigates to the NEW run's page on
 * success, showing the failure inline otherwise. `node_id`/`iteration` name
 * the resume SOURCE (the kept prefix's last visit), resolved by
 * `retryResumeSource` — the retried node is simply whatever the walk replays
 * next. A `*Button.tsx` name keeps this exempt from `no-io-in-view`, same as
 * TriggerReviewButton.
 */

import { useState } from "react";

export function RerunNodeButton({
  runId,
  resumeNodeId,
  resumeIteration,
}: {
  runId: string;
  resumeNodeId: string;
  resumeIteration: number;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rerun(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/assembly-runs/rerun", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        body: new URLSearchParams({
          run_id: runId,
          node_id: resumeNodeId,
          iteration: String(resumeIteration),
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };

      if (!res.ok || !data.id) {
        setError(data.error ?? `retry failed (${res.status})`);
        setPending(false);

        return;
      }
      window.location.assign(`/assembly-runs/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
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
