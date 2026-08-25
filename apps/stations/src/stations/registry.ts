/**
 * Every station in the factory, and the contract they share.
 *
 * ONE registry, replacing the three that could not check each other: the pod
 * image's runner map, the service's URL map, and lore-api's maintenance map —
 * two of which had a byte-identical signature and no idea the other existed.
 *
 * A `Record<StationName, StationModule>`, not a Map: a name in the list with no
 * module is a COMPILE error, which is the whole point. The runner map it
 * replaces was `Record<string, …>`, so a missing entry reached a pod and died
 * there with `unknown station type`.
 */

import type { StationModule } from "./lib/station.js";
import { anthropicCostSync } from "./anthropic-cost-sync/manifest.js";
import { approvalCheck } from "./approval-check/manifest.js";
import { backfillScan } from "./backfill-scan/manifest.js";
import { importanceDecayStation } from "./importance-decay/manifest.js";
import { memoryTtl } from "./memory-ttl/manifest.js";
import { mergeCheck } from "./merge-check/manifest.js";
import { mergeStep } from "./merge-step/manifest.js";
import { validate } from "./validate/manifest.js";
import { retrospective } from "./retrospective/manifest.js";
import { detect } from "./detect/manifest.js";
import { commentTriage } from "./comment-triage/manifest.js";
import { ingest } from "./ingest/manifest.js";
import { issues } from "./issues/manifest.js";
import { featureReview } from "./feature-review/manifest.js";
import { prReview } from "./pr-review/manifest.js";

/** The single list. A folder missing from it fails the registry's own test. */
export const STATION_NAMES = [
  "anthropic-cost-sync",
  "approval-check",
  "backfill-scan",
  "comment-triage",
  "detect",
  "feature-review",
  "importance-decay",
  "ingest",
  "issues",
  "memory-ttl",
  "pr-review",
  "merge-check",
  "merge-step",
  "retrospective",
  "validate",
] as const;

export type StationName = (typeof STATION_NAMES)[number];

export const STATIONS: Record<StationName, StationModule> = {
  "anthropic-cost-sync": anthropicCostSync,
  "approval-check": approvalCheck,
  "backfill-scan": backfillScan,
  "comment-triage": commentTriage,
  detect,
  "feature-review": featureReview,
  "importance-decay": importanceDecayStation,
  ingest,
  issues,
  "memory-ttl": memoryTtl,
  "pr-review": prReview,
  "merge-check": mergeCheck,
  "merge-step": mergeStep,
  retrospective,
  validate,
};
