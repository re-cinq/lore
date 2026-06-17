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
   * Open a new planning round: insert a `running` iteration at
   * current_iteration+1, bump the feature counter, and set status `planning`.
   */
  appendIteration(
    repo: string,
    id: string,
    taskId: string | null,
    userAnswers: unknown,
  ): Promise<FeatureIteration>;
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
