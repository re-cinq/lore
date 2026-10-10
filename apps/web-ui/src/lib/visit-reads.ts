// One visit's model calls and the floor events it handled and raised, read from the browser through the session-authed proxies (run-viz FR4.1i). Anything that is not an answer reads as nothing: a run Lore's own engine walked answers 404.
import type { components } from "@/lib/api/schema";

export type VisitModelCall =
  components["schemas"]["VisitModelCalls"]["calls"][number];
export type VisitEvent = components["schemas"]["VisitEvents"]["events"][number];

const REQUEST_TIMEOUT_MS = 15_000;

export async function readVisitModelCalls(
  runId: string,
  visitId: string,
  cancel?: AbortSignal,
): Promise<VisitModelCall[]> {
  const body = await readVisit<{ calls?: VisitModelCall[] }>(
    runId,
    visitId,
    "model-calls",
    cancel,
  );

  return body?.calls ?? [];
}

export async function readVisitEvents(
  runId: string,
  visitId: string,
  cancel?: AbortSignal,
): Promise<VisitEvent[]> {
  const body = await readVisit<{ events?: VisitEvent[] }>(
    runId,
    visitId,
    "events",
    cancel,
  );

  return body?.events ?? [];
}

async function readVisit<Body>(
  runId: string,
  visitId: string,
  read: "model-calls" | "events",
  cancel: AbortSignal | undefined,
): Promise<Body | null> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(
    `/api/assembly-runs/${encodeURIComponent(runId)}/visits/${encodeURIComponent(visitId)}/${read}`,
    { signal: cancel ? AbortSignal.any([cancel, timeout]) : timeout },
  );

  return response.ok ? ((await response.json()) as Body) : null;
}
