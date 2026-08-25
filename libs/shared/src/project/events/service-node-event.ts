/**
 * The event that carries one service-form node to the stations service.
 *
 * Declared here, not in either end, because both ends need it: the Floor
 * PUBLISHES it in place of creating an Agent CR, and the stations service
 * SUBSCRIBES to it and routes it to the node's station. Spelled twice, a rename
 * on one side typechecks cleanly on both and every service node stalls until
 * the reaper's budget — the exact parallel-list drift this branch removed
 * everywhere else.
 */
export const SERVICE_NODE_EVENT = "station.run";

/** Keyed by the station run, so a redelivery cannot run the node twice. */
export const serviceNodeDedupeKey = (stationRunId: string): string =>
  `station-run:${stationRunId}`;
