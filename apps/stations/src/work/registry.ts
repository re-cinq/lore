/** Registry of every station; missing entry = compile error, preventing "unknown station type" at pod runtime. */

import type { StationModule } from "./lib/station.js";
import { anthropicCostSync } from "./anthropic-cost-sync/manifest.js";
import { ingestSecretRepairStation } from "./ingest-secret-repair/manifest.js";
import { importanceDecayStation } from "./importance-decay/manifest.js";
import { memoryTtl } from "./memory-ttl/manifest.js";
import { mergeCheck } from "./merge-check/manifest.js";
import { specUpkeepTickStation } from "./spec-upkeep-tick/manifest.js";
import { digestTickStation } from "./digest-tick/manifest.js";
import { loopTickStation } from "./loop-tick/manifest.js";
import { blockedReason } from "./blocked-reason/manifest.js";
import { busPrune } from "./bus-prune/manifest.js";
import { prBlockedReasonsPrune } from "./pr-blocked-reasons-prune/manifest.js";
import { telemetryPrune } from "./telemetry-prune/manifest.js";
import { gcpCostSync } from "./gcp-cost-sync/manifest.js";
import { consolidationStation } from "./consolidation/manifest.js";
import { prReadyCheck } from "./pr-ready-check/manifest.js";
import { issueTriageTickStation } from "./issue-triage-tick/manifest.js";
import { utopiaBackfillTickStation } from "./utopia-backfill-tick/manifest.js";

/** The single list. A folder missing from it fails the registry's own test. */
export const STATION_NAMES = [
  "anthropic-cost-sync",
  "blocked-reason",
  "bus-prune",
  "consolidation",
  "digest-tick",
  "gcp-cost-sync",
  "importance-decay",
  "ingest-secret-repair",
  "issue-triage-tick",
  "loop-tick",
  "memory-ttl",
  "merge-check",
  "pr-blocked-reasons-prune",
  "pr-ready-check",
  "spec-upkeep-tick",
  "telemetry-prune",
  "utopia-backfill-tick",
] as const;

export type StationName = (typeof STATION_NAMES)[number];

export const STATIONS: Record<StationName, StationModule> = {
  "anthropic-cost-sync": anthropicCostSync,
  "blocked-reason": blockedReason,
  "bus-prune": busPrune,
  consolidation: consolidationStation,
  "digest-tick": digestTickStation,
  "gcp-cost-sync": gcpCostSync,
  "importance-decay": importanceDecayStation,
  "ingest-secret-repair": ingestSecretRepairStation,
  "issue-triage-tick": issueTriageTickStation,
  "loop-tick": loopTickStation,
  "memory-ttl": memoryTtl,
  "merge-check": mergeCheck,
  "pr-blocked-reasons-prune": prBlockedReasonsPrune,
  "pr-ready-check": prReadyCheck,
  "spec-upkeep-tick": specUpkeepTickStation,
  "telemetry-prune": telemetryPrune,
  "utopia-backfill-tick": utopiaBackfillTickStation,
};
