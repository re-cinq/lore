/**
 * Rules that decide what spec-drift acts on. Kept pure and separate from the
 * job so the doc-type filter, drift signal, dedup window, and failure
 * classification are unit-testable.
 */

import type { TraceDocument } from "../index.js";
import { OPEN_TASK_STATES } from "../project/tasks/task-store-port.js";

/** Speckit artifacts that are prose, not named-symbol sources — scanning them
 * for "missing code symbols" yields permanent 100% false drift. */
const NON_ASSERTION_BASENAMES = new Set([
  "research",
  "plan",
  "tasks",
  "quickstart",
]);

/** True when a spec file is worth checking for drift (names code, not concepts). */
export function isAssertionSource(filePath: string): boolean {
  const file = filePath.split("/").pop() || filePath;
  const stem = file.replace(/\.[^.]+$/, "").toLowerCase();

  return !NON_ASSERTION_BASENAMES.has(stem);
}

/** Days a resolved (merged/completed/cancelled) spec keeps suppressing re-filing. */
export const DRIFT_REFILE_COOLDOWN_DAYS = 14;

/**
 * Days a *failed* drift task keeps suppressing re-filing. Short on purpose: a
 * failure is not a resolution, so genuine drift must resurface — but not the
 * same day. (A `failed` task that suppressed forever is what buried the #571
 * batch after its infra outage.)
 */
export const DRIFT_FAILED_REFILE_COOLDOWN_DAYS = 2;

/** Task states where a drift loop is still in flight — always suppress a new task.
 * Single-sourced with gap-detect via the shared OPEN_TASK_STATES. */
const OPEN_STATES = new Set<string>(OPEN_TASK_STATES);

interface ExistingDriftTask {
  status: string;
  created_at: string | Date;
}

/**
 * Skip creating a drift task when one is already in flight for the spec, or when
 * a resolved/failed one is still within its cooldown — stops the weekly duplicate
 * PRs without letting a failed task suppress real drift forever.
 */
export function shouldSkipDrift(
  existing: ExistingDriftTask[],
  now: Date,
): boolean {
  return existing.some((t) => {
    if (OPEN_STATES.has(t.status)) {
      return true;
    }
    const cooldownDays =
      t.status === "failed"
        ? DRIFT_FAILED_REFILE_COOLDOWN_DAYS
        : DRIFT_REFILE_COOLDOWN_DAYS;
    const age = now.getTime() - new Date(t.created_at).getTime();

    return age < cooldownDays * 86400_000;
  });
}

// ── Graph-primary drift signal ──────────────────────────────────────────────

export interface DriftedStatement {
  text: string;
  ordinal: number;
  section?: string;
  reason: "violated" | "drifted";
  links: { kind: string; label: string; path?: string; line?: number }[];
}

export interface GraphDriftDecision {
  /** False when the spec has no projected statements (fall back to the heuristic). */
  available: boolean;
  drifted: boolean;
  statements: DriftedStatement[];
}

/**
 * Decide drift from the spec-trace graph: a statement drifts when a binding test
 * fails (`violated`) or the projection flagged it (`drifted`). Deterministic and
 * statement-level — no LLM, no symbol guessing. Pure markdown link-rot is owned
 * by the link-rot validate pass, so it does not surface here.
 */
export function decideGraphDrift(doc: TraceDocument): GraphDriftDecision {
  const headingByUid = new Map(
    (doc.sections ?? []).map((s) => [s.uid, s.heading]),
  );
  const statements: DriftedStatement[] = (doc.statements ?? [])
    .filter((s) => s.violated || s.drifted)
    .map((s) => ({
      text: s.text,
      ordinal: s.ordinal,
      section: s.sectionUid ? headingByUid.get(s.sectionUid) : undefined,
      reason: s.violated ? "violated" : "drifted",
      links: (s.links ?? []).map((l) => ({
        kind: l.kind,
        label: l.label,
        path: l.path,
        line: l.line,
      })),
    }));

  return {
    available: (doc.statements?.length ?? 0) > 0,
    drifted: statements.length > 0,
    statements,
  };
}

// ── Heuristic fallback (symbol membership) ──────────────────────────────────

/** Divergence ratio above which the heuristic considers a spec drifted. */
export const DIVERGENCE_THRESHOLD = 0.2;

/** Minimum missing symbols required — a 1-of-N miss is noise, not drift. */
export const MIN_MISSING_ASSERTIONS = 3;

/** Assertion kinds reliably present as `symbol_name` in code chunks. */
const SCORABLE_KINDS = new Set(["function", "class", "interface", "type"]);

export function isScorableKind(kind: string): boolean {
  return SCORABLE_KINDS.has(kind);
}

export interface DriftAssertion {
  name: string;
  kind: string;
  description: string;
}

export interface HeuristicDriftDecision {
  drifted: boolean;
  missing: DriftAssertion[];
  divergence: number;
  scored: number;
}

/**
 * Symbol-membership drift, de-noised: only score assertions whose kind maps to a
 * top-level symbol (endpoints/fields/methods are non-authoritative and produced
 * the healthz false positive), and require both a divergence ratio over the
 * threshold and an absolute floor of missing symbols.
 */
export function decideHeuristicDrift(
  assertions: DriftAssertion[],
  knownSymbols: Set<string>,
): HeuristicDriftDecision {
  const scorable = assertions.filter((a) => isScorableKind(a.kind));
  const missing = scorable.filter(
    (a) => !knownSymbols.has(a.name.toLowerCase()),
  );
  const divergence =
    scorable.length === 0 ? 0 : missing.length / scorable.length;
  const drifted =
    divergence > DIVERGENCE_THRESHOLD &&
    missing.length >= MIN_MISSING_ASSERTIONS;

  return { drifted, missing, divergence, scored: scorable.length };
}
