// The package's public surface — a barrel only; the registry itself lives in `registry.ts`, because a module that both DEFINES the registry and re-exports its consumers is a cycle (the lookup read STATIONS at module-eval time and got undefined).

export * from "./lib/station.js";
export { STATIONS, STATION_NAMES, type StationName } from "./registry.js";
export { nodeStationFor } from "./node-station-lookup.js";
