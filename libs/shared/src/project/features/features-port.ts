import type { GapResult } from "../../feature-planning/gap-result.js";

/**
 * Feature-planning lifecycle port. Backed by `lore.features` +
 * `lore.feature_iterations` (the `lore` schema, owned by the migration runner).
 * This is the persistence side of the smart feature page: drafts, per-round
 * iterations, and the uncommitted working spec. See specs/7-feature-planning/
 * and ADR-027. SQL lives in the pg adapter.
 */

/** The lifecycle states a feature can actually reach.
 *
 *  `split` was declared here and rendered as a badge but never written by any code
 *  path. It could not be: `/split` creates a CHILD and leaves the parent untouched,
 *  and the author may create one child per proposed sub-feature — so there is no
 *  moment the machine can call the parent "split" without guessing. Reviving it
 *  means an explicit author action ("this feature is now its children"), which is
 *  product surface, not a status default. The DB CHECK constraint still permits the
 *  value; it is a harmless superset, and `statusBadge` falls back for anything it
 *  does not know. */
export type FeatureStatus =
  | "draft"
  | "planning"
  | "awaiting-input"
  | "spec-ready"
  | "pr-open"
  | "implemented";

export type IterationStatus = "running" | "ready" | "failed";

export interface Feature {
  id: string;
  repo: string;
  title: string;
  slug: string;
  path: string;
  original_prompt: string;
  status: FeatureStatus;
  current_iteration: number;
  draft_spec_md: string | null;
  parent_feature_id: string | null;
  spec_path: string | null;
  spec_pr_url: string | null;
  spec_pr_number: number | null;
  issue_number: number | null;
  issue_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FeatureIteration {
  id: string;
  feature_id: string;
  iteration: number;
  task_id: string | null;
  status: IterationStatus;
  user_answers: unknown | null;
  gap_result: GapResult | null;
  /** The round this one continued from — set when the author rewound to an earlier
   *  round instead of the latest. Null for a normal next round. */
  parent_iteration: number | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureWithIterations extends Feature {
  iterations: FeatureIteration[];
}

export interface CreateFeatureInput {
  title: string;
  prompt: string;
  parentFeatureId?: string;
  createdBy?: string;
}

/** Fields a status transition may also patch in the same write. */
export interface FeaturePatch {
  draft_spec_md?: string;
  spec_path?: string;
  spec_pr_url?: string;
  spec_pr_number?: number;
  issue_number?: number;
  issue_url?: string;
}

/**
 * Columns a {@link FeaturePatch} may set, in a fixed order for stable params.
 * Shared by the Pg adapter (dynamic SQL) and the in-memory double so both apply
 * exactly the same patch surface.
 */
export const PATCH_COLUMNS: (keyof FeaturePatch)[] = [
  "draft_spec_md",
  "spec_path",
  "spec_pr_url",
  "spec_pr_number",
  "issue_number",
  "issue_url",
];

export interface FeaturesPort {
  /** Insert a draft feature (status `draft`); slug + path derived from title. */
  create(repo: string, input: CreateFeatureInput): Promise<Feature>;
  /** Feature + its iterations (newest-iteration order), or null. */
  get(repo: string, id: string): Promise<FeatureWithIterations | null>;
  /** Features for a repo, newest-updated first, optionally filtered by status. */
  list(repo: string, status?: FeatureStatus): Promise<Feature[]>;
  /**
   * Open a new planning round: bump the feature counter, set status `planning`,
   * and insert a `running` iteration at the minted `current_iteration`. Returns
   * the row so the caller spawns the pod with the iteration the DB actually
   * minted (not a pre-read guess) — {@link attachIterationTask} links the task
   * once it exists.
   */
  appendIteration(
    repo: string,
    id: string,
    userAnswers: unknown,
    parentIteration?: number | null,
  ): Promise<FeatureIteration>;
  /** Link a spawned planning task to its iteration row (repo-scoped). */
  attachIterationTask(
    repo: string,
    id: string,
    iteration: number,
    taskId: string,
  ): Promise<void>;
  /** Persist a round's validated gap result and mark the iteration `ready`/`failed`. */
  setIterationResult(
    repo: string,
    id: string,
    iteration: number,
    gap: GapResult | null,
    status: IterationStatus,
  ): Promise<void>;
  /** Move the feature to a new status, optionally patching draft/PR/Issue fields. */
  transitionStatus(
    repo: string,
    id: string,
    status: FeatureStatus,
    patch?: FeaturePatch,
  ): Promise<Feature>;
  /** Create a child draft linked to its parent (used by the split flow). */
  createSplitChild(
    repo: string,
    parentId: string,
    input: CreateFeatureInput,
  ): Promise<Feature>;
  /** Delete a feature and its iterations (CASCADE). Returns false if not found. */
  delete(repo: string, id: string): Promise<boolean>;
}

/** Whether a feature may be finalized — only from a settled planning state. A draft
 *  with no analysis, or an already-shipped feature, must not kick a finalize task. */
export function canFinalize(status: FeatureStatus): boolean {
  return status === "awaiting-input" || status === "spec-ready";
}

/**
 * The most recent ready round's gap result, or null. Iterations arrive oldest-first,
 * so this scans from the end — the round-to-round context carry and the split source
 * are always the LATEST analysis, not the first one produced.
 */
export function latestReadyGap(
  iterations: FeatureIteration[],
): GapResult | null {
  for (let i = iterations.length - 1; i >= 0; i--) {
    const it = iterations[i];

    if (it.status === "ready" && it.gap_result) {
      return it.gap_result;
    }
  }

  return null;
}

/** How long a `running` iteration may block a new round before it's presumed
 *  orphaned (its pod died) and a fresh round is allowed to supersede it. Covers the
 *  round timeout (≤15 min) plus container/finalize overhead. */
export const ROUND_IN_FLIGHT_MS = 20 * 60_000;

/**
 * The in-flight planning round for a feature — a `running` iteration started within
 * {@link ROUND_IN_FLIGHT_MS} — or null. Used to reject a concurrent/duplicate round
 * for the same feature (a stale page or double-click must not spawn a second pod). A
 * `running` iteration older than the window is treated as orphaned and does NOT block.
 */
export function roundInFlight(
  iterations: FeatureIteration[],
  nowMs: number,
  windowMs: number = ROUND_IN_FLIGHT_MS,
): FeatureIteration | null {
  return (
    iterations.find(
      (it) =>
        it.status === "running" && Date.parse(it.created_at) > nowMs - windowMs,
    ) ?? null
  );
}

/** How long a `running` iteration may linger before the reaper force-fails it
 *  even when the runtime probe still reports it active (a wedged container that
 *  never exits). Generously past the round timeout so a legitimately-slow round
 *  is never killed; the primary orphan signal is the dead container/pod probe. */
export const PLANNING_RECOVERY_STALE_MS = 30 * 60_000;

/** How long after a round starts the runtime probe is not yet trusted to mean
 *  "dead". A round is a task row, then an assembly line, then an Agent CR, then a
 *  pod — the CR does not exist for the first seconds, so a probe in that window says
 *  "not born yet", not "died". Round 10 was force-failed 32s in and survived only
 *  because the delivered result overrode the reaper (2026-08-10). Generous enough to
 *  cover a controller restart or image pull, far short of the round timeout. */
export const PLANNING_STARTUP_GRACE_MS = 2 * 60_000;

/** What the feature-planning reaper should do for one mid-planning feature. */
export type PlanningRecovery =
  | { kind: "none" }
  | { kind: "orphan"; iteration: number }
  | { kind: "transition"; iteration: number };

/**
 * Decide how to reconcile a mid-planning feature whose latest round looks stuck.
 * Pure — the reaper resolves `isActive` (the runtime probe of the latest running
 * iteration's task) and persists the outcome.
 *
 * - latest `running` + (runtime gone past the startup grace OR older than
 *   `windowMs`) → `orphan`: the
 *   round's container/pod died (e.g. a restart) but the row was never closed, so
 *   the wizard "analyzes" forever. Mark it failed + revert the feature.
 * - latest `ready` with a result while the feature is still `planning` → the
 *   status transition was missed (non-atomic write); re-apply it (`transition`).
 * - otherwise `none`. `isActive` is consulted only for the running case.
 */
export function decidePlanningRecovery(args: {
  iterations: FeatureIteration[];
  featureStatus: FeatureStatus;
  isActive: boolean;
  nowMs: number;
  windowMs?: number;
  /** True when the round's task has an OPEN assembly run. The run is then the
   *  single liveness authority — the assembly-run reaper owns its timeouts and
   *  relaunches — so the running case never orphans here. Without this, a k8s
   *  probe that transiently listed zero CRs executed a live round (#1297,
   *  2026-08-18: the analyze agent had already SUCCEEDED when the reaper
   *  failed its iteration). */
  runOpen?: boolean;
}): PlanningRecovery {
  const {
    iterations,
    featureStatus,
    isActive,
    nowMs,
    windowMs = PLANNING_RECOVERY_STALE_MS,
  } = args;
  const latest = iterations[iterations.length - 1];

  if (!latest) {
    return { kind: "none" };
  }

  if (latest.status === "running") {
    if (args.runOpen) {
      return { kind: "none" };
    }
    const ageMs = nowMs - Date.parse(latest.created_at);
    const stale = ageMs > windowMs;
    // Inside the grace window an absent runtime means the CR has not been created
    // yet, so the probe cannot be read as "died". Staleness still orphans: a wedged
    // container that never exits must not be protected by the grace period.
    const startingUp = ageMs < PLANNING_STARTUP_GRACE_MS;

    return (!isActive && !startingUp) || stale
      ? { kind: "orphan", iteration: latest.iteration }
      : { kind: "none" };
  }

  if (
    latest.status === "ready" &&
    latest.gap_result &&
    featureStatus === "planning"
  ) {
    return { kind: "transition", iteration: latest.iteration };
  }

  return { kind: "none" };
}

/** Slug a feature title into a `specs/<slug>` directory-safe identifier. */
export function slugifyFeatureTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug || "feature";
}

/** The round a new round builds on: the one the author rewound to, or the latest
 *  ready one. A rewind target that is not a READY round is rejected rather than
 *  silently ignored — continuing from a failed round means continuing from nothing,
 *  and the author would see a fresh start dressed as a rewind. */
export type RoundBasis =
  { ok: true; basis: FeatureIteration | null } | { ok: false; error: string };

export function resolveRoundBasis(
  iterations: FeatureIteration[],
  fromIteration?: number,
): RoundBasis {
  if (fromIteration === undefined) {
    return { ok: true, basis: latestReadyIteration(iterations) };
  }
  const chosen = iterations.find((it) => it.iteration === fromIteration);

  if (!chosen) {
    return { ok: false, error: `no round ${fromIteration} for this feature` };
  }

  return chosen.status === "ready" && chosen.gap_result
    ? { ok: true, basis: chosen }
    : {
        ok: false,
        error: `round ${fromIteration} produced no result to continue from`,
      };
}

/** The newest round that produced a result, or null. */
export function latestReadyIteration(
  iterations: FeatureIteration[],
): FeatureIteration | null {
  for (let i = iterations.length - 1; i >= 0; i--) {
    if (iterations[i].status === "ready" && iterations[i].gap_result) {
      return iterations[i];
    }
  }

  return null;
}
