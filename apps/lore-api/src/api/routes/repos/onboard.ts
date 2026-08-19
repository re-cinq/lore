import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { onboardRepo } from "../../../features/repo/repo-onboard.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

const OnboardBody = z.object({
  repo: z
    .string()
    .includes("/", { message: "required: repo (owner/name format)" }),
  /** Deliberate repair pass over an already-onboarded repo (regenerates only
   *  the scaffolding it is missing). Waives only the already-onboarded block —
   *  never the in-flight or open-PR one. */
  reonboard: z.boolean().optional(),
});

type OnboardBody = z.infer<typeof OnboardBody>;

/**
 * Onboarding answers with the queued task, or — at 409 — with the block that
 * refused it and the task already holding the repo. A refusal is existing state,
 * not a failure, which is why it is a declared shape rather than an error string.
 */
const OnboardResultSchema = z.union([
  z.object({
    repo_id: z.string(),
    task_id: z.string(),
    status: z.string(),
    webhook: z.union([
      z.object({
        ok: z.literal(true),
        hookId: z.number(),
        created: z.boolean(),
      }),
      z.object({
        ok: z.literal(false),
        reason: z.string(),
        detail: z.string().optional(),
      }),
    ]),
  }),
  z.object({
    blocked: z.string(),
    error: z.string(),
    task_id: z.string().nullable(),
  }),
]);

export function onboardRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/onboard",
    options: zodResponse(
      {
        ...bearerScope("admin"),
        validate: { payload: zodValidate(OnboardBody) },
      },
      OnboardResultSchema,
      {
        name: "OnboardResult",
        description: "The queued onboarding, or the block that refused it",
        errors: [400, 409],
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      try {
        const { repo, reonboard } = request.payload as OnboardBody;
        const result = await onboardRepo(pool, repo, { reonboard });

        // A guarded refusal is a conflict with existing state, not a failure:
        // 409 so callers can tell it apart from a broken onboarding.
        return "blocked" in result
          ? h.response(result).code(409)
          : h.response(result);
      } catch (err) {
        console.error("[onboard] API error:", errorMessage(err));

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
