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
   * The DAY the money landed, which is not always the day someone got round to
   * recording it. Omitted means today.
   *
   * A day alone anchors to its START, so the whole day's spend counts against
   * the balance. That is deliberate and it is the safe direction: over-counting
   * understates what is left, while under-counting would tell someone they have
   * money they have already spent. `effective_time` buys back the precision
   * when it is actually known.
   */
  effective_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "effective_date must be YYYY-MM-DD")
    // Shape is not validity. `2026-02-30` matches the regex above and makes
    // Postgres raise 22008 (date/time field value out of range) — a code the
    // handler does not catch, so it rethrew as a 500 and told the caller the
    // server was broken when the truth was a typo in their own date. Rebuild
    // the date and check it did not roll over: JS normalises February 30th to
    // March 2nd rather than refusing it, and the rollover is the tell.
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
  /**
   * The time of day the money landed, when it is known. Only ever consulted
   * for the OPENING entry, since that is the one moment the remaining
   * arithmetic reads — a later top-up contributes its amount and nothing else,
   * so recording it days late changes no figure.
   *
   * The case it exists for: entering an opening balance partway through a day
   * that has already been spending. Anchoring at midnight there would charge
   * the morning against a balance that did not yet exist.
   */
  effective_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "effective_time must be HH:MM")
    .optional(),
  kind: z.enum(["opening", "topup", "correction"]).default("topup"),
  note: z.string().default(""),
  /** Free text, not an authenticated identity — this API has bearer tokens,
   *  not users, and pretending otherwise would make the audit trail lie. */
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

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      const {
        amount_usd,
        effective_date,
        effective_time,
        kind,
        note,
        recorded_by,
      } = request.payload as z.infer<typeof CreditEntryBody>;

      try {
        // Day and time are composed in Postgres rather than here: this process
        // has no business deciding what day it is for the database, and the
        // midnight default keeps an unknown time counting the whole day rather
        // than silently skipping the part of it that already spent money.
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
