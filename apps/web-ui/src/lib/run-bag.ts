// A run's bag, read from the browser through the session-authed proxy (run-viz FR4.4n). Null for anything that is not a bag: a run the floor does not have answers 404, and a failed read says nothing.
import type { components } from "@/lib/api/schema";

export type RunBag = components["schemas"]["RunBag"]["bag"];

const REQUEST_TIMEOUT_MS = 15_000;

export async function readRunBag(runId: string): Promise<RunBag | null> {
  const response = await fetch(
    `/api/assembly-runs/${encodeURIComponent(runId)}/bag`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );

  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as Partial<
    components["schemas"]["RunBag"]
  >;

  return body.bag ?? null;
}
