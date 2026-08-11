"use client";

/**
 * "Rerun from here" — forks the run from one completed node
 * (specs/fork-rerun-from-node). A native form POST to the
 * /api/assembly-lines/[id]/rerun proxy (which forwards to the Floor), then a
 * redirect to the new fork's run page. A `*Button.tsx` name keeps it exempt
 * from `no-io-in-view`.
 */
export function RerunFromNodeButton({
  runId,
  nodeId,
}: {
  runId: string;
  nodeId: string;
}) {
  return (
    <form action={`/api/assembly-lines/${runId}/rerun`} method="POST">
      <input type="hidden" name="node_id" value={nodeId} />
      <button type="submit">Rerun from here</button>
    </form>
  );
}
