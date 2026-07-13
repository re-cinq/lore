import type { GapResult } from "../../feature-planning/gap-result.js";

/**
 * Feature-planning lifecycle port. Backed by `lore.features` +
 * `lore.feature_iterations` (the `lore` schema, owned by the migration runner).
 * This is the persistence side of the smart feature page: drafts, per-round
 * iterations, and the uncommitted working spec. See specs/7-feature-planning/
 * and ADR-027. SQL lives in the pg adapter.
 */

export type FeatureStatus =
  | "draft"
  | "planning"
  | "awaiting-input"
  | "spec-ready"
  | "pr-open"
  | "implemented"
  | "split";

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
    if (it.status === "ready" && it.gap_result) return it.gap_result;
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
 * - latest `running` + (runtime gone OR older than `windowMs`) → `orphan`: the
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
}): PlanningRecovery {
  const {
    iterations,
    featureStatus,
    isActive,
    nowMs,
    windowMs = PLANNING_RECOVERY_STALE_MS,
  } = args;
  const latest = iterations[iterations.length - 1];
  if (!latest) return { kind: "none" };
  if (latest.status === "running") {
    const stale = nowMs - Date.parse(latest.created_at) > windowMs;
    return !isActive || stale
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
