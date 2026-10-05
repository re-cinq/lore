/** Registry of every station; missing entry = compile error, preventing "unknown station type" at pod runtime. */

import type { StationModule } from "./lib/station.js";
import { anthropicCostSync } from "./anthropic-cost-sync/manifest.js";
import { importanceDecayStation } from "./importance-decay/manifest.js";
import { memoryTtl } from "./memory-ttl/manifest.js";
import { mergeCheck } from "./merge-check/manifest.js";
import { specTaskTickStation } from "./spec-task-tick/manifest.js";
import { specUpkeepTickStation } from "./spec-upkeep-tick/manifest.js";
import { digestTickStation } from "./digest-tick/manifest.js";
import { loopTickStation } from "./loop-tick/manifest.js";
import { busPrune } from "./bus-prune/manifest.js";
import { telemetryPrune } from "./telemetry-prune/manifest.js";
import { gcpCostSync } from "./gcp-cost-sync/manifest.js";
import { consolidationStation } from "./consolidation/manifest.js";
import { prReadyCheck } from "./pr-ready-check/manifest.js";
import { triageLabel } from "./triage-label/manifest.js";

/** The single list. A folder missing from it fails the registry's own test. */
export const STATION_NAMES = [
  "anthropic-cost-sync",
  "bus-prune",
  "consolidation",
  "digest-tick",
  "gcp-cost-sync",
  "importance-decay",
  "loop-tick",
  "memory-ttl",
  "merge-check",
  "pr-ready-check",
  "spec-task-tick",
  "spec-upkeep-tick",
  "telemetry-prune",
  "triage-label",
] as const;

export type StationName = (typeof STATION_NAMES)[number];

export const STATIONS: Record<StationName, StationModule> = {
  "anthropic-cost-sync": anthropicCostSync,
  "bus-prune": busPrune,
  consolidation: consolidationStation,
  "digest-tick": digestTickStation,
  "gcp-cost-sync": gcpCostSync,
  "importance-decay": importanceDecayStation,
  "loop-tick": loopTickStation,
  "memory-ttl": memoryTtl,
  "merge-check": mergeCheck,
  "pr-ready-check": prReadyCheck,
  "spec-task-tick": specTaskTickStation,
  "spec-upkeep-tick": specUpkeepTickStation,
  "telemetry-prune": telemetryPrune,
  "triage-label": triageLabel,
};
