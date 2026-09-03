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

/** Pool shape with rowCount on result; satisfies rowCount-reading ports (LeasePool) without cast. */
export interface FakePgPool extends PgPool {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
}

/** Scripted PgPool fake; responses consumed in order, calls recorded, beyond-script throws (catches extra queries). */
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
