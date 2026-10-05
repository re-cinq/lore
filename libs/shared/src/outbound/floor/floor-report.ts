import type { FloorClient, Report } from "@re-cinq/floor-client";

const REPORTED_BY = "lore";

/** The half of the floor a report needs. */
export interface VisitReporter {
  events: Pick<FloorClient["events"], "post">;
}

/** A person's answer to a human station, told to the floor as the `station_run.reported` event a station's own worker posts: a visit nobody claims has no other way to be answered. */
export async function reportToVisit(
  events: Pick<FloorClient["events"], "post">,
  visitId: string,
  report: Report,
): Promise<void> {
  await events.post({
    name: "station_run.reported",
    payload: { visitId, worker: REPORTED_BY, report },
    dedupeKey: `station_run.reported:${visitId}`,
  });
}
