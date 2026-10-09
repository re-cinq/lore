// A run's bag, read from the browser through the session-authed proxy (run-viz FR4.4n). Null for anything that is not a bag: a run the floor does not have answers 404, and a failed read says nothing.
import type { components } from "@/lib/api/schema";
import type { AssemblyRunNode } from "@/lib/assembly-run-rows";

export type RunBag = components["schemas"]["RunBag"]["bag"];

const REQUEST_TIMEOUT_MS = 15_000;

/** `cancel` ends the read early, for a caller that has already asked again; the timeout still bounds it. */
export async function readRunBag(
  runId: string,
  cancel?: AbortSignal,
): Promise<RunBag | null> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(
    `/api/assembly-runs/${encodeURIComponent(runId)}/bag`,
    { signal: cancel ? AbortSignal.any([cancel, timeout]) : timeout },
  );

  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as Partial<
    components["schemas"]["RunBag"]
  >;

  return body.bag ?? null;
}

/** Changes when the run's status or a visit's outcome does — the moments the floor's bag can have gained an item. A visit starting changes nothing: it has produced nothing yet, and the previous visit finishing already prompted a read. */
export function bagRefreshKey(
  status: string,
  nodes: readonly AssemblyRunNode[],
): string {
  const finished = nodes
    .filter((node) => node.outcome !== null)
    .map((node) => `${node.nodeId}:${node.iteration}:${node.outcome}`);

  return `${status}|${finished.join(",")}`;
}
