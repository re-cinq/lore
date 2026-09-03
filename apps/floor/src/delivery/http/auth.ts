/** Bearer-token auth: hapi scheme + ingest-token (503) + internal-token (401) strategies. */

import { apiError } from "./api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
// Shared constant-time compare; prevents drift from `bearer.ts` hardening.
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
