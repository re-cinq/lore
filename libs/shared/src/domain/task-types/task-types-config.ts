/** The one declaration of `scripts/task-types.yaml`, replacing 4 disagreeing readers. Parsing is TOLERANT by design (also ships as a ConfigMap that can lag the code, #866) — it reports `drift` instead of throwing. */

import { parse } from "yaml";
import { z } from "zod";

export const TaskTypeConfigSchema = z.object({
  prompt_template: z.string(),
  timeout_minutes: z.number(),
  review_required: z.boolean(),
  model: z.string(),
  /** Explicitly `null` on entries that declare it — the task targets its raised-against repo. Nullable, never merely optional (a bare `?: string` can't represent the file's own spelling). */
  target_repo: z.string().nullable().optional(),
  /** "claude-code" (default, LLM), "graph-ingest" or "station" (deterministic). */
  execution_mode: z.string().optional(),
  /** Default true (agent starts in the cloned repo); false omits workingDir for read-only recipes (#1160). */
  repo_workdir: z.boolean().optional(),
  /** Extra tool denies appended after the base pipeline-tool deny (#1160). */
  disallowed_tools: z.array(z.string()).optional(),
  /** A file this run is expected to produce, raised as a `kind:"file"` event once the agent exits (ai-agent-subsystem#188). */
  watch: z.object({ event: z.string(), path: z.string() }).optional(),
  /** Extra agent skills fetched from the gateway's /skills registry, APPENDED to `lore-context` (never replacing it). */
  skills: z.array(z.string()).optional(),
});

export type TaskTypeConfig = z.infer<typeof TaskTypeConfigSchema>;

/** What a READER may actually be handed vs. what a complete entry declares — the parse keeps entries it couldn't fully validate, so any field may be missing. */
export type TaskTypeRecipe = Partial<TaskTypeConfig>;

/** A builtin station recipe (a non-LLM node run by the exec vendor). */
export const StationConfigSchema = z.object({
  /** The argv the exec vendor spawns; the rendered station_input is appended. */
  command: z.array(z.string()),
  timeout_minutes: z.number(),
  /** Plain env for the station pod (e.g. def-ingest's LORE_DGRAPH_HTTP). */
  env: z.record(z.string()).optional(),
  /** Pod-template labels a NetworkPolicy selects — must ride the template, since the per-task triple renames the Station to `pt-<id>`. */
  pod_labels: z.record(z.string()).optional(),
  /** This station calls a model and needs the LLM credential; off by default since a missing credential once made comment-triage silently swallow every PR comment. */
  needs_model: z.boolean().optional(),
});

export type StationConfig = z.infer<typeof StationConfigSchema>;

/** The tolerant read of a station entry — see {@link TaskTypeRecipe}. */
export type StationRecipe = Partial<StationConfig>;

export interface TaskTypesFile {
  taskTypes: Record<string, TaskTypeRecipe>;
  stations: Record<string, StationRecipe>;
  /** One `<section>.<name>: <field> — <why>` line per entry that did not match; non-empty means the reader is older/newer than the YAML it was handed. */
  drift: string[];
}

/** The value if it is shaped like an entry at all, an empty entry otherwise. */
const readable = (value: unknown): object =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

function pushEntryDrift(
  drift: string[],
  entryLabel: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
): void {
  for (const issue of issues) {
    // `issue.path` is empty when the ENTRY itself is wrong (e.g. `general:` with no body parses as null).
    const field = issue.path.length > 0 ? issue.path.join(".") : "<entry>";

    drift.push(`${entryLabel}: ${field} — ${issue.message}`);
  }
}

function readSection<T>(
  section: string,
  raw: unknown,
  schema: z.ZodType<T>,
  drift: string[],
): Record<string, T> {
  const entries =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, T> = {};

  for (const [name, value] of Object.entries(entries)) {
    const result = schema.safeParse(value);

    if (!result.success) {
      pushEntryDrift(drift, `${section}.${name}`, result.error.issues);
    }
    // Kept either way (dropping it is the stale-ConfigMap outage); an unreadable entry becomes EMPTY, not null, so consumer defaults still apply.
    out[name] = (result.success ? result.data : readable(value)) as T;
  }

  return out;
}

/** Parse the YAML text into the two sections, reporting rather than raising. */
export function parseTaskTypesFile(text: string): TaskTypesFile {
  const parsed = parse(text) as {
    task_types?: unknown;
    stations?: unknown;
  } | null;
  const drift: string[] = [];

  return {
    taskTypes: readSection(
      "task_types",
      parsed?.task_types,
      TaskTypeConfigSchema,
      drift,
    ),
    stations: readSection(
      "stations",
      parsed?.stations,
      StationConfigSchema,
      drift,
    ),
    drift,
  };
}

/** Reports a mismatch between the file a process read and the schema its code carries — every reader must call this or silently reintroduce the #866 ConfigMap-lag risk. */
export function warnOnDrift(tag: string, path: string, drift: string[]): void {
  if (drift.length > 0) {
    console.warn(
      `${tag} ${path} does not match the task-type schema: ${drift.join("; ")}`,
    );
  }
}
