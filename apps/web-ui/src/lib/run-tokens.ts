import type { components } from "@/lib/api/schema";
/**
 * What a run has spent in tokens — the shapes and the arithmetic, and NOTHING ELSE.
 *
 * Deliberately free of IO, because `RunningCard` is a client component: importing a
 * value from a module that reaches `db` drags `pg` into the browser bundle and the
 * build dies on `Can't resolve 'fs'`. The read that fills these numbers lives in
 * `assembly-runs.ts` with the rest of the run queries.
 */

/** One turn's usage, already unwrapped from the stream-json envelope by SQL. */
export type TurnUsageRow = components["schemas"]["AssemblyRunTokenUsage"];

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
