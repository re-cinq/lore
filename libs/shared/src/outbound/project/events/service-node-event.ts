/** Service node event: declared once, shared by Floor (publisher) and stations service (subscriber). */
export const SERVICE_NODE_EVENT = "station.run";

/** Keyed by the station run, so a redelivery cannot run the node twice. */
export const serviceNodeDedupeKey = (stationRunId: string): string =>
  `station-run:${stationRunId}`;
