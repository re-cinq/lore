/**
 * Bearer-token auth as a hapi scheme + two strategies, replacing the inline
 * `authorization?.replace("Bearer ", "")` checks the old handlers each rolled by
 * hand:
 *  - `ingest-token`   → LORE_INGEST_TOKEN          (ci-ingest, ci-tests)
 *  - `internal-token` → LORE_AGENT_INTERNAL_TOKEN  (agent-events)
 *
 * The expected token is read once at strategy registration (server build). A
 * missing token short-circuits exactly as before: 503 for the ingest routes,
 * 401 for the internal sink. A wrong token is always 401.
 */

import { apiError } from "./api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
// The one constant-time compare every service shares. The Floor had a private
// byte-for-byte copy, which is exactly the drift `bearer.ts` was written to end:
// a hardening applied there would have left this strategy on the old code.
import { secretEquals } from "@re-cinq/lore-shared/http/bearer.js";
import type { Server, ServerAuthScheme } from "@hapi/hapi";

interface BearerOptions {
  token: string | undefined;
  unconfiguredStatusCode: 401 | 503;
  unconfiguredMessage: string;
}

const bearerScheme: ServerAuthScheme = (_server, options) => {
  const { token, unconfiguredStatusCode, unconfiguredMessage } =
    options as BearerOptions;

  return {
    authenticate(request, h) {
      enforceTrue(token, apiError(unconfiguredStatusCode), unconfiguredMessage);
      const header = request.headers.authorization;
      const provided = (Array.isArray(header) ? header[0] : header)?.replace(
        "Bearer ",
        "",
      );

      enforceTrue(
        provided !== undefined && secretEquals(provided, token),
        apiError(401),
        "unauthorized",
      );

      return h.authenticated({ credentials: {} });
    },
  };
};

export function registerBearerAuth(server: Server): void {
  server.auth.scheme("bearer", bearerScheme);
  server.auth.strategy("ingest-token", "bearer", {
    token: process.env.LORE_INGEST_TOKEN,
    unconfiguredStatusCode: 503,
    unconfiguredMessage: "ingest token not configured",
  } satisfies BearerOptions);
  server.auth.strategy("internal-token", "bearer", {
    token: process.env.LORE_AGENT_INTERNAL_TOKEN,
    unconfiguredStatusCode: 401,
    unconfiguredMessage: "unauthorized",
  } satisfies BearerOptions);
}
