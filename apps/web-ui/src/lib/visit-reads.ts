// One visit's model calls and the floor events it handled and raised, read from the browser over the live socket (run-viz FR4.1i). Anything that is not an answer reads as nothing: a run Lore's own engine walked answers 404.
import type { components } from "@/lib/api/schema";
import { liveFetch } from "@/lib/live-fetch";

export type VisitModelCall =
  components["schemas"]["VisitModelCalls"]["calls"][number];
export type VisitEvent = components["schemas"]["VisitEvents"]["events"][number];

export async function readVisitModelCalls(
  runId: string,
  visitId: string,
): Promise<VisitModelCall[]> {
  const body = await readVisit<{ calls?: VisitModelCall[] }>(
    runId,
    visitId,
    "model-calls",
  );

  return body?.calls ?? [];
}

export async function readVisitEvents(
  runId: string,
  visitId: string,
): Promise<VisitEvent[]> {
  const body = await readVisit<{ events?: VisitEvent[] }>(
    runId,
    visitId,
    "events",
  );

  return body?.events ?? [];
}

async function readVisit<Body>(
  runId: string,
  visitId: string,
  read: "model-calls" | "events",
): Promise<Body | null> {
  const response = await liveFetch(
    `/api/assembly-runs/${encodeURIComponent(runId)}/visits/${encodeURIComponent(visitId)}/${read}`,
  );

  return response.ok ? ((await response.json()) as Body) : null;
}
