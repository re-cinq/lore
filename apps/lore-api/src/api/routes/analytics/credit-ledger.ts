import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
// Records money added to the Anthropic account (no balance-read endpoint exists); append-only, corrections are compensating negative rows, never updates.

import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

const UNDEFINED_TABLE = "42P01";

const CreditEntryBody = z.object({
  // Dollars matching anthropic_cost_daily.cost_usd; negative expresses a correction, zero is rejected here (400) rather than by the CHECK constraint (500).
  amount_usd: z.number().refine((n) => n !== 0, "amount_usd must not be zero"),
  // The DAY the money landed (default today); anchors to its START so the whole day's spend counts — over-counting is the safe direction. effective_time refines it.
  effective_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "effective_date must be YYYY-MM-DD")
    // Shape isn't validity: `2026-02-30` matches the regex but makes Postgres raise 22008 (uncaught -> 500); JS normalizes rollover instead of refusing, so check for it.
    .refine((value) => {
      const [year, month, dayOfMonth] = value.split("-").map(Number);
      const rebuilt = new Date(year, month - 1, dayOfMonth);

      return (
        rebuilt.getFullYear() === year &&
        rebuilt.getMonth() === month - 1 &&
        rebuilt.getDate() === dayOfMonth
      );
    }, "effective_date must be a real calendar date")
    .optional(),
  // Time of day the money landed; only the OPENING entry's arithmetic reads it — lets a same-day opening balance skip charging the morning before it existed.
  effective_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "effective_time must be HH:MM")
    .optional(),
  kind: z.enum(["opening", "topup", "correction"]).default("topup"),
  note: z.string().default(""),
  // Free text, not an authenticated identity — this API has bearer tokens, not users.
  recorded_by: z.string().default(""),
});

const CreditEntrySchema = z.object({
  id: z.number(),
  /** ISO-8601 UTC instant — the moment the balance changed, not the day. */
  effective_at: z.string(),
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

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      const {
        amount_usd,
        effective_date,
        effective_time,
        kind,
        note,
        recorded_by,
      } = request.payload as z.infer<typeof CreditEntryBody>;

      try {
        // Day and time compose in Postgres, not here; midnight default counts the whole day rather than silently skipping already-spent money.
        const { rows } = await pool.query(
          `INSERT INTO pipeline.credit_ledger
             (effective_at, amount_usd, kind, note, actor)
           VALUES (
             COALESCE($1::date, current_date)
               + COALESCE($2::time, time '00:00'),
             $3, $4, $5, $6)
           RETURNING id::int,
             to_char(effective_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS effective_at,
             amount_usd::float8, kind, note, actor`,
          [
            effective_date ?? null,
            effective_time ?? null,
            amount_usd,
            kind,
            note,
            recorded_by,
          ],
        );

        return h.response(rows[0]).code(201);
      } catch (err) {
        // Table arrives with migration 0045; an undeployed cluster should say the figure is unrecordable, not that the request is malformed.
        enforceTrue(
          (err as { code?: string }).code !== UNDEFINED_TABLE,
          apiError(503),
          DB_UNAVAILABLE,
        );

        throw err;
      }
    },
  };
}
