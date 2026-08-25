/**
 * The one declaration of `scripts/task-types.yaml`.
 *
 * Four readers used to describe this file, each partially and none the same:
 * the Floor's runtime dispatch config, server-core's pipeline config, the
 * `AgentDefsYaml` fallback, and the agent catalog generator. They disagreed on
 * whether `target_repo` could be null, on whether `model` existed at all, and on
 * which fields were required — so the file itself, not a consumer's assumption,
 * settles the split here.
 *
 * Required is what the committed file actually carries on EVERY entry. The four
 * fields below are 16/16 on task types and `command`/`timeout_minutes` are 8/8 on
 * stations; everything else genuinely varies.
 *
 * Parsing is TOLERANT by design. This file also ships as a ConfigMap, and a
 * cluster running a stale copy has been the cause of a silent outage before
 * (#866). A schema that threw would turn that into a crash loop; one that reports
 * `drift` lets the caller log the mismatch and keep serving the entries it can
 * read.
 */

import { parse } from "yaml";
import { z } from "zod";

export const TaskTypeConfigSchema = z.object({
  prompt_template: z.string(),
  timeout_minutes: z.number(),
  review_required: z.boolean(),
  model: z.string(),
  /** Explicitly `null` on the 11 entries that declare it — the task targets the
   *  repo it was raised against. Nullable, never merely optional: an explicit
   *  null and an absent key mean the same thing here, and typing it `?: string`
   *  (as server-core did) makes the file's own spelling unrepresentable. */
  target_repo: z.string().nullable().optional(),
  /** "claude-code" (default, LLM), "graph-ingest" or "station" (deterministic). */
  execution_mode: z.string().optional(),
  /** Default true: the agent starts in the cloned repo. False omits workingDir for
   *  read-only recipes that must not build in a checkout they only read (#1160). */
  repo_workdir: z.boolean().optional(),
  /** Extra tool denies appended after the base pipeline-tool deny (#1160). */
  disallowed_tools: z.array(z.string()).optional(),
  /** A file this run is expected to produce, raised as a named `kind:"file"`
   *  event once the agent exits (ai-agent-subsystem#188). */
  watch: z.object({ event: z.string(), path: z.string() }).optional(),
});

export type TaskTypeConfig = z.infer<typeof TaskTypeConfigSchema>;

/** What a READER may actually be handed, as opposed to what a complete entry
 *  declares. The parse keeps entries it could not fully validate, and the
 *  container reads this file from a ConfigMap that can lag the code — so the
 *  type says "any of these may be missing" and the caller enforces the ones it
 *  genuinely needs. Every consumer already defaulted these; this makes that
 *  visible instead of relying on a type that promised more than it delivered. */
export type TaskTypeRecipe = Partial<TaskTypeConfig>;

/** A builtin station recipe (a non-LLM node run by the exec vendor). */
export const StationConfigSchema = z.object({
  /** The argv the exec vendor spawns; the rendered station_input is appended. */
  command: z.array(z.string()),
  timeout_minutes: z.number(),
  /** Plain env for the station pod (e.g. def-ingest's LORE_DGRAPH_HTTP). */
  env: z.record(z.string()).optional(),
  /** Pod-template labels a NetworkPolicy selects. MUST ride the template, not the
   *  Station name — the per-task triple renames the Station to `pt-<id>`. */
  pod_labels: z.record(z.string()).optional(),
  /**
   * This station calls a model, so its pod needs the LLM credential.
   *
   * Off by default: most stations are deterministic and a credential they never
   * use is surface for nothing. But a station that DOES call one and is not
   * given it fails in the worst way — comment-triage swallowed the failure into
   * `ignore` and reported success, silently dropping every human PR comment.
   */
  needs_model: z.boolean().optional(),
});

export type StationConfig = z.infer<typeof StationConfigSchema>;

/** The tolerant read of a station entry — see {@link TaskTypeRecipe}. */
export type StationRecipe = Partial<StationConfig>;

export interface TaskTypesFile {
  taskTypes: Record<string, TaskTypeRecipe>;
  stations: Record<string, StationRecipe>;
  /** One `<section>.<name>: <field> — <why>` line per entry that did not match.
   *  Empty on the committed file; non-empty means the reader is older or newer
   *  than the YAML it was handed. */
  drift: string[];
}

/** The value if it is shaped like an entry at all, an empty entry otherwise. */
const readable = (value: unknown): object =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

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
      for (const issue of result.error.issues) {
        // `issue.path` is empty when the ENTRY itself is wrong (`general:` with
        // no body parses as null), and "task_types.general:  — Expected object"
        // names no field at all. The entry is the field in that case.
        const field = issue.path.length > 0 ? issue.path.join(".") : "<entry>";

        drift.push(`${section}.${name}: ${field} — ${issue.message}`);
      }
    }
    // The entry is kept either way: a reader that drops what it cannot fully
    // validate is the stale-ConfigMap outage, not the fix for it.
    //
    // "What it can read" stops at an object, though. A `general:` with no body
    // is null, and keeping it verbatim hands a consumer `null` typed as a
    // recipe — `buildNodePrompt` guards `!== undefined`, which null passes, and
    // then throws a raw TypeError instead of the diagnostic this parse just
    // wrote. An unreadable entry becomes an EMPTY one, so every consumer's
    // existing per-field default carries it.
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

/**
 * Report a mismatch between the file a process read and the schema its code
 * carries.
 *
 * Every reader calls this. The YAML also ships as a ConfigMap that can lag any
 * of the three images independently, so a reader that takes `taskTypes` and
 * drops `drift` carries the #866 risk with no warning — which is the whole
 * failure this parse exists to make visible.
 */
export function warnOnDrift(tag: string, path: string, drift: string[]): void {
  if (drift.length > 0) {
    console.warn(
      `${tag} ${path} does not match the task-type schema: ${drift.join("; ")}`,
    );
  }
}
