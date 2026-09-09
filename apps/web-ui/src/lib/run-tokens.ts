import type { components } from "@/lib/api/schema";
/** Token counts: shapes and arithmetic only (IO-free for client bundle; values in assembly-runs.ts). */

/** One turn's usage, already unwrapped from the stream-json envelope by SQL. */
export type TurnUsageRow = components["schemas"]["AssemblyRunTokenUsage"];

export interface RunTokens {
  /** Includes cache creation and reads (all billed). */
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
