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
  /** When the visit opened: a by-hand start is the last one posted before it. */
  openedAt: string;
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
  const byHandStart = byHandStartOf(visit, events);

  return events.flatMap((floorEvent) => {
    const relation = relationOf(visit, floorEvent, byHandStart);

    return relation ? [rowOf(floorEvent, relation)] : [];
  });
}

function relationOf(
  visit: VisitForEvents,
  floorEvent: FloorEventView,
  byHandStart: string | null,
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

  return startedIt(visit, floorEvent, payload) || floorEvent.id === byHandStart
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

/** The walk's start of the node for this iteration. */
function startedIt(
  visit: VisitForEvents,
  floorEvent: FloorEventView,
  payload: Record<string, unknown>,
): boolean {
  return (
    startsNode(visit, floorEvent) &&
    payload.iteration !== undefined &&
    payload.iteration === visit.iteration
  );
}

/** A by-hand start names no iteration, so a visit run by hand claims the last such start posted before it opened. */
function byHandStartOf(
  visit: VisitForEvents,
  events: readonly FloorEventView[],
): string | null {
  if (visit.requestedBy === null) {
    return null;
  }
  const before = events.filter(
    (floorEvent) =>
      startsNode(visit, floorEvent) &&
      payloadOf(floorEvent).iteration === undefined &&
      floorEvent.createdAt <= visit.openedAt,
  );

  return before.at(-1)?.id ?? null;
}

function startsNode(
  visit: VisitForEvents,
  floorEvent: FloorEventView,
): boolean {
  return (
    floorEvent.name === visit.startEvent &&
    payloadOf(floorEvent).nodeId === visit.nodeId
  );
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
