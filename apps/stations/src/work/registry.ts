/** Registry of every station; missing entry = compile error, preventing "unknown station type" at pod runtime. */

import type { StationModule } from "./lib/station.js";
import { anthropicCostSync } from "./anthropic-cost-sync/manifest.js";
import { approvalCheck } from "./approval-check/manifest.js";
import { importanceDecayStation } from "./importance-decay/manifest.js";
import { memoryTtl } from "./memory-ttl/manifest.js";
import { mergeCheck } from "./merge-check/manifest.js";
import { mergeStep } from "./merge-step/manifest.js";
import { specTaskTickStation } from "./spec-task-tick/manifest.js";
import { specUpkeepTickStation } from "./spec-upkeep-tick/manifest.js";
import { validate } from "./validate/manifest.js";
import { retrospective } from "./retrospective/manifest.js";
import { detect } from "./detect/manifest.js";
import { digestTickStation } from "./digest-tick/manifest.js";
import { ingest } from "./ingest/manifest.js";
import { loopTickStation } from "./loop-tick/manifest.js";
import { busPrune } from "./bus-prune/manifest.js";
import { telemetryPrune } from "./telemetry-prune/manifest.js";
import { issues } from "./issues/manifest.js";
import { featureReview } from "./feature-review/manifest.js";
import { gcpCostSync } from "./gcp-cost-sync/manifest.js";
import { ciCheck } from "./ci-check/manifest.js";
import { prReadyCheck } from "./pr-ready-check/manifest.js";
import { prReview } from "./pr-review/manifest.js";

/** The single list. A folder missing from it fails the registry's own test. */
export const STATION_NAMES = [
  "anthropic-cost-sync",
  "approval-check",
  "bus-prune",
  "ci-check",
  "detect",
  "digest-tick",
  "feature-review",
  "gcp-cost-sync",
  "importance-decay",
  "ingest",
  "issues",
  "loop-tick",
  "memory-ttl",
  "merge-check",
  "merge-step",
  "pr-ready-check",
  "pr-review",
  "retrospective",
  "spec-task-tick",
  "spec-upkeep-tick",
  "telemetry-prune",
  "validate",
] as const;

export type StationName = (typeof STATION_NAMES)[number];

export const STATIONS: Record<StationName, StationModule> = {
  "anthropic-cost-sync": anthropicCostSync,
  "approval-check": approvalCheck,
  "bus-prune": busPrune,
  "ci-check": ciCheck,
  detect,
  "digest-tick": digestTickStation,
  "feature-review": featureReview,
  "gcp-cost-sync": gcpCostSync,
  "importance-decay": importanceDecayStation,
  ingest,
  issues,
  "loop-tick": loopTickStation,
  "memory-ttl": memoryTtl,
  "merge-check": mergeCheck,
  "merge-step": mergeStep,
  "pr-ready-check": prReadyCheck,
  "pr-review": prReview,
  retrospective,
  "spec-task-tick": specTaskTickStation,
  "spec-upkeep-tick": specUpkeepTickStation,
  "telemetry-prune": telemetryPrune,
  validate,
};
