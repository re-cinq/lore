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
    iterations.find((it) => it.status === "running" && Date.parse(it.created_at) > nowMs - windowMs) ?? null
  );
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
