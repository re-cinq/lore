// The run-row wire projection: the schema and the pure mapping of a port-selected AssemblyRunSummary plus its enrichment, free of any database read.

import { z } from "zod";
import type { AssemblyRunSummary } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

// A CROSS-TABLE read model (task PR + task Issue + summed cost + args pr_number), not a projection of pipeline.assembly_runs; snake_case keys since that's what deployed web-ui reads, deliberately apart from the AssemblyRun model.
export const RunRowSchema = z.object({
  id: z.string(),
  blueprint_name: z.string(),
  definition_name: z.string(),
  task_id: z.string().nullable(),
  repo: z.string(),
  branch: z.string().nullable(),
  subject_key: z.string().nullable(),
  /** Which engine walks the run: `floor` for one on the external floor, which the run page may read and watch but not re-run. */
  engine: z.string(),
  graph: z.unknown().optional(),
  status: z.string(),
  outcome: z.string().nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  args_pr_number: z.number().nullable(),
  /** The spec analysis's summary from `args.spec_plan`: while a planning line waits on its author after `analyse-specs` asked for changes, this is the question the author must answer. */
  spec_plan_summary: z.string().nullable(),
  pr_url: z.string().nullable(),
  task_pr_number: z.number().nullable(),
  issue_url: z.string().nullable(),
  issue_number: z.number().nullable(),
  created_by: z.string().nullable(),
  cost_usd: z.number().nullable(),
});

// The six ENRICH_SELECT columns, picked from the RunRowSchema wire contract declared above.
export type RunEnrichment = Pick<
  z.infer<typeof RunRowSchema>,
  | "pr_url"
  | "task_pr_number"
  | "issue_url"
  | "issue_number"
  | "created_by"
  | "cost_usd"
>;

/** One run as the list views read it — no graph, which only a task-centric caller needs. */
export function toRunRow(
  run: AssemblyRunSummary,
  enrichment: RunEnrichment | undefined,
) {
  return runRow(run, enrichment, {});
}

// graph itself may still be unresolved (predates clones AND blueprint gone).
/** The same row plus the run's cloned graph, for a caller that draws the DAG. */
export function toRunRowWithGraph(
  run: AssemblyRunSummary & { graph?: unknown },
  enrichment: RunEnrichment | undefined,
) {
  return runRow(run, enrichment, { graph: run.graph ?? null });
}

function runRow(
  run: AssemblyRunSummary,
  enrichment: RunEnrichment | undefined,
  graphField: Record<string, unknown>,
) {
  return {
    ...identity(run),
    ...graphField,
    ...lifecycle(run),
    args_pr_number: argsPrNumber(run.args["pr_number"]),
    spec_plan_summary: specPlanSummary(run.args["spec_plan"]),
    ...enrichedFields(enrichment, run.args["actor"]),
  };
}

// One run as the run views read it; definition_name doubles blueprint_name under its pre-rename spelling for the legacy-alias rollout window — DELETE alongside that alias.
/** What the run IS. `definition_name` is served alongside `blueprint_name` with the same value: it is the pre-rename spelling, kept because clients still read it. */
function identity(run: AssemblyRunSummary) {
  return {
    id: run.id,
    blueprint_name: run.blueprintName,
    definition_name: run.blueprintName,
    task_id: run.taskId,
    repo: run.repo,
    branch: run.branch,
    subject_key: run.subjectKey,
    engine: run.args["engine"] === "floor" ? "floor" : "lore",
  };
}

/** Where the run GOT to. `started_at` and `finished_at` are nullable because a queued run has neither — the created time is the only one every run has. */
function lifecycle(run: AssemblyRunSummary) {
  return {
    status: run.status,
    outcome: run.outcome,
    reason: run.reason,
    created_at: run.createdAt.toISOString(),
    started_at: isoOrNull(run.startedAt),
    finished_at: isoOrNull(run.finishedAt),
  };
}

function isoOrNull(at: Date | null): string | null {
  return at ? at.toISOString() : null;
}

// PR number from a run's args, or null; a bare Number() coercion turns null/"" into 0, rendering a link to a PR that doesn't exist — the replaced SQL answered NULL for both.
function argsPrNumber(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }

  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : null;
}

// The artifact lands in args as the JSON text the pod wrote (or, in tests, as an object); either way the summary is its only line a person reads.
function specPlanSummary(raw: unknown): string | null {
  const plan = typeof raw === "string" ? parsedJson(raw) : raw;
  const summary = (plan as { summary?: unknown } | null)?.summary;

  return typeof summary === "string" && summary.trim() ? summary : null;
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** What a run with no task (or no matching enrichment row) carries. */
const NO_ENRICHMENT: RunEnrichment = {
  pr_url: null,
  task_pr_number: null,
  issue_url: null,
  issue_number: null,
  created_by: null,
  cost_usd: null,
};

// Only created_by falls further than its own column, to the actor the run itself recorded.
function enrichedFields(
  enrichment: RunEnrichment | undefined,
  argsActor: unknown,
): RunEnrichment {
  const actorFallback = (argsActor as string | null) ?? null;

  return {
    ...NO_ENRICHMENT,
    ...enrichment,
    created_by: enrichment?.created_by ?? actorFallback,
  };
}
