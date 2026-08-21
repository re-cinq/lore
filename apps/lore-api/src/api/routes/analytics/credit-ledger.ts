/**
 * `POST /api/spend/credits` — record money added to the Anthropic account.
 *
 * This exists because Anthropic's Admin API reports usage and cost and does
 * NOT expose a credit balance: there is no endpoint to read, so the balance
 * has to be told to us, and this is where it gets told. `GET /api/spend`
 * turns the accumulated tellings into the remaining figure.
 *
 * Append-only. A wrong entry is corrected with a compensating row
 * (`kind: "correction"`, negative amount), never an update — which is why
 * every write here is a single INSERT with no prior read. Two people recording
 * a top-up at the same moment cannot lose one another's entry.
 */

import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

const UNDEFINED_TABLE = "42P01";

const CreditEntryBody = z.object({
  /**
   * Dollars, matching `anthropic_cost_daily.cost_usd`, so both sides of
   * `remaining = ledger - spend` share a unit. Negative is allowed and is how
   * a correction is expressed; zero moves no balance and is rejected here
   * rather than by the CHECK constraint, so the caller gets a 400 with a
   * reason instead of a 500 with a Postgres error.
   */
  amount_usd: z.number().refine((n) => n !== 0, "amount_usd must not be zero"),
  /**
   * When the money landed, which is not always when someone got round to
   * recording it. Defaults to today, because the common case is recording a
   * top-up the day it happens and a form should not ask for what it can
   * assume.
   */
  effective_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "effective_date must be YYYY-MM-DD")
    .optional(),
  kind: z.enum(["opening", "topup", "correction"]).default("topup"),
  note: z.string().default(""),
  /** Free text, not an authenticated identity — this API has bearer tokens,
   *  not users, and pretending otherwise would make the audit trail lie. */
  recorded_by: z.string().default(""),
});

const CreditEntrySchema = z.object({
  id: z.number(),
  effective_date: z.string(),
  amount_usd: z.number(),
  kind: z.string(),
  note: z.string(),
  actor: z.string(),
});

export function creditLedgerRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/spend/credits",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(CreditEntryBody) },
      },
      CreditEntrySchema,
      {
        name: "CreditEntryRecorded",
        status: 201,
        description: "The balance entry that was recorded",
        errors: [400],
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      const { amount_usd, effective_date, kind, note, recorded_by } =
        request.payload as z.infer<typeof CreditEntryBody>;

      try {
        const { rows } = await pool.query(
          `INSERT INTO pipeline.credit_ledger
             (effective_date, amount_usd, kind, note, actor)
           VALUES (COALESCE($1::date, current_date), $2, $3, $4, $5)
           RETURNING id::int, effective_date::text, amount_usd::float8,
             kind, note, actor`,
          [effective_date ?? null, amount_usd, kind, note, recorded_by],
        );

        return h.response(rows[0]).code(201);
      } catch (err) {
        // The table arrives with migration 0045. A cluster that has not
        // deployed it yet should say so plainly — the figure is unrecordable,
        // not the request malformed.
        if ((err as { code?: string }).code === UNDEFINED_TABLE) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }

        throw err;
      }
    },
  };
}
