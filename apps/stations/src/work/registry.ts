/** Registry of every station; missing entry = compile error, preventing "unknown station type" at pod runtime. */

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
import { gcpCostSync } from "./gcp-cost-sync/manifest.js";
import { prReadyCheck } from "./pr-ready-check/manifest.js";
import { prReview } from "./pr-review/manifest.js";
import { escalationStep } from "./escalation-step/manifest.js";

/** The single list. A folder missing from it fails the registry's own test. */
export const STATION_NAMES = [
  "anthropic-cost-sync",
  "approval-check",
  "backfill-scan",
  "comment-triage",
  "detect",
  "escalation-step",
  "feature-review",
  "gcp-cost-sync",
  "importance-decay",
  "ingest",
  "issues",
  "memory-ttl",
  "merge-check",
  "merge-step",
  "pr-ready-check",
  "pr-review",
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
  "escalation-step": escalationStep,
  "feature-review": featureReview,
  "gcp-cost-sync": gcpCostSync,
  "importance-decay": importanceDecayStation,
  ingest,
  issues,
  "memory-ttl": memoryTtl,
  "merge-check": mergeCheck,
  "merge-step": mergeStep,
  "pr-ready-check": prReadyCheck,
  "pr-review": prReview,
  retrospective,
  validate,
};
