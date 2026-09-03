import type { GapResult } from "../../feature-planning/gap-result.js";

// Feature-planning lifecycle port over lore.features + lore.feature_iterations; persistence side of the smart feature page (specs/7-feature-planning, ADR-027). SQL lives in the pg adapter.

/** Lifecycle states a feature can actually reach. `split` is DB-permitted but never written — reviving it needs an explicit author action, not a status default (see specs/7-feature-planning). */
export type FeatureStatus =
  | "draft"
  | "planning"
  | "awaiting-input"
  | "spec-ready"
  | "pr-open"
  | "implemented";

export type IterationStatus = "running" | "ready" | "failed";

/** What a finished round leaves behind: its validated gap result (null when it produced none) and the status that follows from it. */
export interface IterationResult {
  gap: GapResult | null;
  status: IterationStatus;
}

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
  /** The round this one continued from, if the author rewound to an earlier round; null for a normal next round. */
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

/** Columns a {@link FeaturePatch} may set, fixed order for stable params; shared by the Pg adapter and the in-memory double. */
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
  /** Opens a new planning round (bumps counter, status `planning`, inserts `running` iteration); returns the row so the caller spawns the pod with the DB-minted iteration, not a pre-read guess. */
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
    result: IterationResult,
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

/** Whether a feature may be finalized (only from a settled planning state — never a bare draft or an already-shipped feature). */
export function canFinalize(status: FeatureStatus): boolean {
  return status === "awaiting-input" || status === "spec-ready";
}

/** Most recent ready round's gap result, or null; scans from the end since iterations arrive oldest-first and callers want the latest analysis. */
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

/** How long a `running` iteration blocks a new round before it's presumed orphaned; covers the round timeout (≤15 min) plus container/finalize overhead. */
export const ROUND_IN_FLIGHT_MS = 20 * 60_000;

/** The in-flight planning round (a `running` iteration within {@link ROUND_IN_FLIGHT_MS}) or null; rejects a concurrent/duplicate round from a stale page or double-click. */
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

/** How long a `running` iteration may linger before the reaper force-fails it even if the probe still reports it active (a wedged container); generous past the round timeout. */
export const PLANNING_RECOVERY_STALE_MS = 30 * 60_000;

/** Startup grace before the runtime probe is trusted to mean "dead" (a round becomes a task row, then a line, then a CR, then a pod) — round 10 was force-failed 32s in and only survived because the result overrode the reaper (2026-08-10). */
export const PLANNING_STARTUP_GRACE_MS = 2 * 60_000;

/** The `running`-status half of {@link decidePlanningRecovery}: orphans a round whose runtime died past startup grace or outlived the window. */
function runningRecovery(
  latest: { created_at: string; iteration: number },
  probe: {
    runOpen?: boolean;
    isActive: boolean;
    nowMs: number;
    windowMs: number;
  },
): PlanningRecovery {
  if (probe.runOpen) {
    return { kind: "none" };
  }
  const ageMs = probe.nowMs - Date.parse(latest.created_at);
  const stale = ageMs > probe.windowMs;
  // Inside the grace window an absent runtime means "not created yet", not "died"; staleness still orphans so a wedged container isn't protected by the grace period.
  const startingUp = ageMs < PLANNING_STARTUP_GRACE_MS;

  return (!probe.isActive && !startingUp) || stale
    ? { kind: "orphan", iteration: latest.iteration }
    : { kind: "none" };
}

/** What the feature-planning reaper should do for one mid-planning feature. */
export type PlanningRecovery =
  | { kind: "none" }
  | { kind: "orphan"; iteration: number }
  | { kind: "transition"; iteration: number };

/** Pure: reconciles a mid-planning feature whose latest round looks stuck. Running+dead-runtime -> orphan (mark failed, revert feature); ready+still-planning -> transition (re-apply a missed status write); else none. */
export function decidePlanningRecovery(args: {
  iterations: FeatureIteration[];
  featureStatus: FeatureStatus;
  isActive: boolean;
  nowMs: number;
  windowMs?: number;
  /** True when the round's task has an OPEN assembly run — then the run reaper owns liveness and this never orphans (fixes #1297, 2026-08-18: a transient k8s probe failed an already-succeeded round). */
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
    return runningRecovery(latest, {
      runOpen: args.runOpen,
      isActive,
      nowMs,
      windowMs,
    });
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

/** Slugs a title into a directory-safe id capped at `max`; trailing-dash trim runs AFTER the slice since the cut can land on a `-`. `max`/`fallback` are params (not two functions) since the two callers differ only there. */
export function slugifyTitle(
  title: string,
  max: number,
  fallback = "",
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");

  return slug || fallback;
}

/** Slug a feature title into a `specs/<slug>` directory-safe identifier. */
export function slugifyFeatureTitle(title: string): string {
  return slugifyTitle(title, 60, "feature");
}

/** The round a new round builds on (rewind target or latest ready); a non-ready rewind target is rejected rather than silently ignored, so a fresh start is never dressed as a rewind. */
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
