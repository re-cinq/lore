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
import { approvalCheck } from "./stations/approval-check/manifest.js";
import { validate } from "./stations/validate/manifest.js";
import { gate } from "./stations/gate/manifest.js";
import { githubAction } from "./stations/github-action/manifest.js";
import { retrospective } from "./stations/retrospective/manifest.js";
import { detect } from "./stations/detect/manifest.js";
import { commentTriage } from "./stations/comment-triage/manifest.js";
import { ingest } from "./stations/ingest/manifest.js";
import { issues } from "./stations/issues/manifest.js";

/** The single list. A folder missing from it fails the registry's own test. */
export const STATION_NAMES = [
  "approval-check",
  "comment-triage",
  "detect",
  "gate",
  "github-action",
  "ingest",
  "issues",
  "retrospective",
  "validate",
] as const;

export type StationName = (typeof STATION_NAMES)[number];

export const STATIONS: Record<StationName, StationModule> = {
  "approval-check": approvalCheck,
  "comment-triage": commentTriage,
  detect,
  gate,
  "github-action": githubAction,
  ingest,
  issues,
  retrospective,
  validate,
};
