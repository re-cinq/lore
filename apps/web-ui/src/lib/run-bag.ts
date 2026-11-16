// A run's bag, read from the browser over the live socket as the signed-in person (run-viz FR4.4n). Null for anything that is not a bag: a run the floor does not have answers 404, and a failed read says nothing.
import type { components } from "@/lib/api/schema";
import type { AssemblyRunNode } from "@/lib/assembly-run-rows";
import { liveFetch } from "@/lib/live-fetch";

export type RunBag = components["schemas"]["RunBag"]["bag"];

export async function readRunBag(runId: string): Promise<RunBag | null> {
  const response = await liveFetch(
    `/api/assembly-runs/${encodeURIComponent(runId)}/bag`,
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
