import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { onboardRepo } from "../../../features/repo/repo-onboard.js";
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

export function onboardRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/onboard",
    options: {
      ...bearerScope("admin"),
      validate: { payload: zodValidate(OnboardBody) },
    },
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
