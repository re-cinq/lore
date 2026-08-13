import { enforceTrue } from "../lib/enforce.js";
import type { PgPool } from "../memory-store.js";

/** One recorded query() invocation. */
export interface FakePgPoolCall {
  text: string;
  params?: unknown[];
}

/** One scripted response; `rowCount` defaults to `rows.length`. */
export interface FakePgPoolResponse {
  rows?: unknown[];
  rowCount?: number;
}

/**
 * The pool shape {@link fakePgPool} returns: {@link PgPool} widened with
 * `rowCount` on the result, so the same fake also satisfies rowCount-reading
 * ports (e.g. the leases' `LeasePool`) without a cast.
 */
export interface FakePgPool extends PgPool {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
}

/**
 * Scripted {@link PgPool} fake for adapter SQL-shape tests: responses are
 * consumed in call order, every invocation is recorded in `calls`, and a call
 * beyond the scripted responses throws (an adapter issuing an extra query must
 * fail the test, not silently read empty rows). Replaces the per-file
 * hand-rolled `mockPool`s (the untyped ones hid `pool as any` casts).
 */
export function fakePgPool(responses: FakePgPoolResponse[] = []): {
  pool: FakePgPool;
  calls: FakePgPoolCall[];
} {
  const calls: FakePgPoolCall[] = [];
  const pool: FakePgPool = {
    async query<T>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[]; rowCount: number }> {
      calls.push({ text, params });
      const response = responses[calls.length - 1];

      enforceTrue(
        response,
        Error,
        `fakePgPool: unexpected call ${calls.length} — only ${responses.length} response(s) scripted.\nSQL: ${text}`,
      );
      const rows = (response.rows ?? []) as T[];

      return { rows, rowCount: response.rowCount ?? rows.length };
    },
  };

  return { pool, calls };
}
