// What one visit of a floor run called and which events it handled and raised (run-viz FR4.1i). Both answer null for a visit of no run the floor has, so a caller cannot read another run's visit by naming it.
import type {
  FloorEventView,
  RecordKind,
  RunView,
  StationRunRecordView,
  VisitView,
} from "@re-cinq/floor-client";
import type { LineFacts } from "./floor-line-facts.js";
import { modelCallsOf, type ModelCall } from "./floor-model-calls.js";
import { visitEventsOf, type VisitEventRow } from "./floor-visit-events.js";

/** The reads a visit read needs, each one hop away. */
export interface VisitReadDeps {
  visitById: (visitId: string) => Promise<VisitView | null>;
  runById: (runId: string) => Promise<RunView | null>;
  eventsPage: (runId: string, since: string | undefined) => Promise<EventsPage>;
  recordsOf: (
    visit: VisitView,
    kind: RecordKind,
  ) => Promise<StationRunRecordView[]>;
  lineFactsOf: (run: RunView) => Promise<LineFacts>;
}

export interface EventsPage {
  items: FloorEventView[];
  nextCursor: string | null;
}

export async function visitModelCalls(
  deps: VisitReadDeps,
  runId: string,
  visitId: string,
): Promise<ModelCall[] | null> {
  const visit = await visitOfRun(deps, runId, visitId);

  return visit && modelCallsOf(await deps.recordsOf(visit, "llm_call"));
}

export async function visitEvents(
  deps: VisitReadDeps,
  runId: string,
  visitId: string,
): Promise<VisitEventRow[] | null> {
  const visit = await visitOfRun(deps, runId, visitId);
  const run = visit && (await deps.runById(runId));

  if (!visit || !run) {
    return null;
  }
  const [facts, events] = await Promise.all([
    deps.lineFactsOf(run),
    runEvents(deps, runId),
  ]);
  const startEvent =
    facts.startEvents[visit.nodeId] ?? `node.${visit.nodeId}.start`;

  return visitEventsOf({ ...visit, startEvent }, events);
}

async function visitOfRun(
  deps: VisitReadDeps,
  runId: string,
  visitId: string,
): Promise<VisitView | null> {
  const visit = await deps.visitById(visitId);

  return visit && visit.runId === runId ? visit : null;
}

// A bound on one request's work: past it the card shows the run's oldest events and leaves out the rest.
const MAX_EVENT_PAGES = 25;

/** The run's events, oldest first, read a page at a time from the floor's cursor, at most MAX_EVENT_PAGES pages. */
async function runEvents(
  deps: VisitReadDeps,
  runId: string,
): Promise<FloorEventView[]> {
  const events: FloorEventView[] = [];
  let since: string | undefined;
  let pages = 0;

  do {
    const page = await deps.eventsPage(runId, since);

    pages += 1;
    events.push(...page.items);
    since = page.nextCursor ?? undefined;
  } while (since !== undefined && pages < MAX_EVENT_PAGES);

  return events;
}
