// Every station this service runs, by HTTP or from the bus, passes through here so the `lore.station.*` instruments have one recording site.

import {
  recordStationRun,
  type StationRunRecord,
} from "@re-cinq/lore-shared/otel/metrics.js";

export async function timedStationRun(
  station: string,
  run: () => Promise<string>,
): Promise<string> {
  const startedAt = Date.now();
  const record = (outcome: StationRunRecord["outcome"]) =>
    recordStationRun({ station, outcome, durationMs: Date.now() - startedAt });

  try {
    const summary = await run();

    record("success");

    return summary;
  } catch (err) {
    record("error");
    throw err;
  }
}
