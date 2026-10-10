// The events one visit handled and raised (run-viz FR4.1i). Exact where the floor says so: `visitId` on its dispatch, abort, report and cost note; `causedBy` on what its report enqueued; `answeredVisitIds` on the outside event that answered it. Its own start event names only the node and iteration, so that match is marked inferred.
import type { FloorEventView } from "@re-cinq/floor-client";

export interface VisitForEvents {
  id: string;
  nodeId: string;
  iteration: number;
  /** Set when someone ran the node by hand: its start event then names no iteration. */
  requestedBy: string | null;
  /** The node's start event name: its `start:`, else `node.<id>.start`. */
  startEvent: string;
}

export interface VisitEventRow {
  id: string;
  name: string;
  direction: "handled" | "raised";
  inferred: boolean;
  created_at: string;
  acked_at: string | null;
  claimed_by: string | null;
  attempts: number;
  last_error: string | null;
  dead_at: string | null;
  payload: unknown;
}

type Relation = Pick<VisitEventRow, "direction" | "inferred">;

const HANDLED_BY_ID = new Set(["station_run.dispatch", "station_run.abort"]);
const RAISED_BY_ID = new Set(["station_run.reported", "internal.cost.missing"]);

export function visitEventsOf(
  visit: VisitForEvents,
  events: readonly FloorEventView[],
): VisitEventRow[] {
  return events.flatMap((floorEvent) => {
    const relation = relationOf(visit, floorEvent);

    return relation ? [rowOf(floorEvent, relation)] : [];
  });
}

function relationOf(
  visit: VisitForEvents,
  floorEvent: FloorEventView,
): Relation | null {
  const payload = payloadOf(floorEvent);

  if (payload.visitId === visit.id) {
    return idRelation(floorEvent.name);
  }

  if (objectOf(payload.causedBy).visitId === visit.id) {
    return { direction: "raised", inferred: false };
  }

  if (answered(payload, visit.id)) {
    return { direction: "handled", inferred: false };
  }

  return startedIt(visit, floorEvent, payload)
    ? { direction: "handled", inferred: true }
    : null;
}

function answered(payload: Record<string, unknown>, visitId: string): boolean {
  const visitIds = payload.answeredVisitIds;

  return Array.isArray(visitIds) && visitIds.includes(visitId);
}

function idRelation(name: string): Relation | null {
  if (HANDLED_BY_ID.has(name)) {
    return { direction: "handled", inferred: false };
  }

  return RAISED_BY_ID.has(name)
    ? { direction: "raised", inferred: false }
    : null;
}

/** The node's start for this iteration, or, for a visit run by hand, a start that names no iteration. */
function startedIt(
  visit: VisitForEvents,
  floorEvent: FloorEventView,
  payload: Record<string, unknown>,
): boolean {
  if (floorEvent.name !== visit.startEvent || payload.nodeId !== visit.nodeId) {
    return false;
  }

  return payload.iteration === undefined
    ? visit.requestedBy !== null
    : payload.iteration === visit.iteration;
}

function rowOf(floorEvent: FloorEventView, relation: Relation): VisitEventRow {
  return {
    id: floorEvent.id,
    name: floorEvent.name,
    ...relation,
    created_at: floorEvent.createdAt,
    acked_at: floorEvent.ackedAt,
    claimed_by: floorEvent.claimedBy,
    attempts: floorEvent.attempts,
    last_error: floorEvent.lastError,
    dead_at: floorEvent.deadAt,
    payload: floorEvent.payload,
  };
}

function payloadOf(floorEvent: FloorEventView): Record<string, unknown> {
  return objectOf(floorEvent.payload);
}

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
