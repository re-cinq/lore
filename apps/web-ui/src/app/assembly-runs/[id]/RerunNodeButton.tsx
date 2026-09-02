"use client";

/**
 * "Retry from this node" — fork-and-rerun of a terminal run from the inspected
 * node (specs/fork-rerun-from-node). A native form POST to the
 * /api/assembly-runs/rerun proxy, which starts the fork through lore-api and
 * redirects to the NEW run's page. `node_id`/`iteration` name the resume
 * SOURCE (the kept prefix's last visit), resolved by `retryResumeSource` — the
 * retried node is simply whatever the walk replays next. A `*Button.tsx` name
 * keeps this exempt from `no-io-in-view`, same as TriggerReviewButton.
 */
export function RerunNodeButton({
  runId,
  resumeNodeId,
  resumeIteration,
}: {
  runId: string;
  resumeNodeId: string;
  resumeIteration: number;
}) {
  return (
    <form action="/api/assembly-runs/rerun" method="POST">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="node_id" value={resumeNodeId} />
      <input type="hidden" name="iteration" value={resumeIteration} />
      <button type="submit">Retry from this node</button>
    </form>
  );
}
