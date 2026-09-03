// What this service answers to at `POST /api/stations/{name}` — built FROM the shared registry (a station declaring an `http` trigger appears here) rather than hand-listed, so the URL surface can't disagree with the manifest.

import {
  STATIONS,
  hostCanRun,
  isSweepModule,
  type StationPortName,
} from "../stations/index.js";

/** This service holds a pool AND a GitHub App, so it serves every port. */
const SERVED: readonly StationPortName[] = [
  "awaitingApproval",
  "approvalLabel",
  "repoFor",
  "memoryLifecycle",
  "cost",
  "gcpCost",
];

import type { StationHost } from "../stations/index.js";
import type { Station } from "../delivery/routes/stations.js";

const hasHttpTrigger = (mod: {
  manifest: { triggers: readonly { kind: string }[] };
}) => mod.manifest.triggers.some((t) => t.kind === "http");

let memo: ReadonlyMap<string, Station> | undefined;

// Memoized: the route resolves the registry on every request (twice on a 404), and the map is a constant derived from the manifests.
export function serviceStations(
  host: StationHost,
): ReadonlyMap<string, Station> {
  if (memo) {
    return memo;
  }

  const fromRegistry = Object.values(STATIONS)
    .filter(isSweepModule)
    .filter(hasHttpTrigger)
    .filter((mod) => hostCanRun(mod.manifest, SERVED))
    .map((mod): [string, Station] => [
      mod.manifest.name,
      () => mod.run({ trigger: "http", host }),
    ]);

  memo = new Map<string, Station>(fromRegistry);

  return memo;
}

/** Test seam: the memo is process-wide, so a test changing hosts must clear it. */
export const resetServiceStations = (): void => {
  memo = undefined;
};
