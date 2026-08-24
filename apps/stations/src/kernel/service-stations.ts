/**
 * What this service answers to at `POST /api/stations/{name}`.
 *
 * Built FROM the shared registry rather than hand-listed: a station declares an
 * `http` trigger and appears here, so the URL surface and the station's own
 * manifest cannot disagree. The hand-written map this replaces was one of the
 * three that could not check each other.
 *
 * `merge-check` is still local. It is about to be decomposed into the nodes of a
 * merge assembly line (specs/station-consolidation FR12), and converting its ~25
 * data calls to ports first, only to split them apart immediately after, would
 * be work done twice. It is listed HERE rather than left implicit so the
 * remaining gap is visible and tested.
 */

import { STATIONS, isSweepModule } from "@re-cinq/lore-station-registry";
import type { StationHost } from "@re-cinq/lore-station-registry";
import type { Station } from "../delivery/routes/stations.js";
import { mergeCheckJob } from "../stations/merge-check.js";

const hasHttpTrigger = (mod: {
  manifest: { triggers: readonly { kind: string }[] };
}) => mod.manifest.triggers.some((t) => t.kind === "http");

let memo: ReadonlyMap<string, Station> | undefined;

/**
 * Memoized: the route resolves the registry on every request (twice, on a 404),
 * and the map is a constant derived from the manifests. It stayed a constant
 * before this was built from them, and should stay one now.
 */
export function serviceStations(
  host: StationHost,
): ReadonlyMap<string, Station> {
  if (memo) {
    return memo;
  }

  const fromRegistry = Object.values(STATIONS)
    .filter(isSweepModule)
    .filter(hasHttpTrigger)
    .map((mod): [string, Station] => [
      mod.manifest.name,
      () => mod.run({ trigger: "http", host }),
    ]);

  memo = new Map<string, Station>([
    ...fromRegistry,
    ["merge-check", mergeCheckJob],
  ]);

  return memo;
}

/** Test seam: the memo is process-wide, so a test changing hosts must clear it. */
export const resetServiceStations = (): void => {
  memo = undefined;
};
