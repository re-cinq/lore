import { queryAllowMissing } from "./db";

/**
 * What a run has spent in tokens, live.
 *
 * The source is `pipeline.agent_run_turns` (migration 0037), NOT
 * `pipeline.llm_calls`. The cost table is authoritative and carries dollars, but a
 * row lands only when an agent run ENDS — which for a planning round is the moment
 * the card showing the number disappears. Turns arrive while the pod streams, so
 * they are the only source that can answer "so far" while something is still going.
 *
 * `lore_ui` is granted SELECT on the table by that same migration.
 */

/** One turn's usage, already unwrapped from the stream-json envelope by SQL. */
export interface TurnUsageRow {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface RunTokens {
  /** Prompt side, INCLUDING cache creation and cache reads — all three are billed,
   *  and a "tokens so far" that hid the cached ones would understate a cached run by
   *  an order of magnitude. */
  input: number;
  output: number;
  total: number;
}

/** Total usage across a run's turns, or null when it has reported none yet. */
export function sumTurnUsage(rows: readonly TurnUsageRow[]): RunTokens | null {
  if (rows.length === 0) {
    return null;
  }
  const input = rows.reduce(
    (n, r) =>
      n + r.input_tokens + r.cache_creation_tokens + r.cache_read_tokens,
    0,
  );
  const output = rows.reduce((n, r) => n + r.output_tokens, 0);

  return { input, output, total: input + output };
}

/** A token count at a glance: 940 · 64.0k · 1.3M. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }

  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }

  return String(n);
}

/**
 * A line's usage so far, or null when nothing has been reported (and on any error:
 * the wizard's poll must keep reporting the round's status even when usage is
 * unavailable — a pre-0037 database included).
 *
 * The usage object rides inside the untruncated envelope, so the extraction is
 * SQL-side: summing four scalars beats shipping every turn of a long run to Node
 * every four seconds.
 */
export async function fetchRunTokens(
  assemblyLineId: string | null | undefined,
): Promise<RunTokens | null> {
  if (!assemblyLineId) {
    return null;
  }

  try {
    const rows = await queryAllowMissing<TurnUsageRow>(
      `SELECT
         COALESCE(SUM((usage->>'input_tokens')::bigint), 0)::int AS input_tokens,
         COALESCE(SUM((usage->>'output_tokens')::bigint), 0)::int AS output_tokens,
         COALESCE(SUM((usage->>'cache_creation_input_tokens')::bigint), 0)::int
           AS cache_creation_tokens,
         COALESCE(SUM((usage->>'cache_read_input_tokens')::bigint), 0)::int
           AS cache_read_tokens
       FROM (
         SELECT envelope->'event'->'message'->'usage' AS usage
           FROM pipeline.agent_run_turns
          WHERE assembly_line_id = $1
            AND envelope->'event'->'message' ? 'usage'
       ) turns`,
      [assemblyLineId],
    );
    const summed = sumTurnUsage(rows);

    // The aggregate always answers one row; an all-zero one means no usage yet.
    return summed && summed.total > 0 ? summed : null;
  } catch {
    return null;
  }
}
