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
        const { repo } = request.payload as OnboardBody;

        return h.response(await onboardRepo(pool, repo));
      } catch (err) {
        console.error("[onboard] API error:", errorMessage(err));

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
