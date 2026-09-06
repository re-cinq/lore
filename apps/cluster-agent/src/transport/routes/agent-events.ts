// Agent-telemetry relay: run pods POST NDJSON here, forwarded VERBATIM (never parsed) centrally through the event proxy — queued/retried, no public egress needed, an alternative to FR8's direct ingress.

import type { ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  extractBearer,
  secretEquals,
} from "@re-cinq/lore-shared/http/bearer.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import type { Emit } from "@re-cinq/lore-shared/project/events/event-input-port.js";

/** Matches the Floor's own sink cap, so this relay refuses exactly what the far end would have refused. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface AgentEventsDeps {
  emit: Emit;
  /** The credentials this cluster will accept, resolved PER REQUEST — a thunk because the per-agent token rotates on every re-registration. */
  acceptedTokens: () => Array<string | undefined>;
}

/** Accept the request only if it presents one of this cluster's credentials; every comparison runs even after a match (same reason `secretEquals` exists). */
function enforceAnyBearer(
  headers: Record<string, unknown>,
  accepted: Array<string | undefined>,
): void {
  const configured = accepted.filter((token): token is string =>
    Boolean(token),
  );

  enforceTrue(
    configured.length > 0,
    apiError(500),
    "no credential configured — this cluster has neither LORE_INGEST_TOKEN nor a registered per-agent token yet",
  );

  const presented = extractBearer(headers["authorization"]);
  const matched = configured.reduce(
    (found, token) => secretEquals(presented ?? "", token) || found,
    false,
  );

  enforceTrue(
    presented && matched,
    apiError(401),
    "missing or invalid bearer token — run pods authenticate with this cluster's agent-events credential",
  );
}

export function agentEventsRoutes(deps: AgentEventsDeps): ServerRoute[] {
  return [
    {
      method: "POST",
      path: "/api/cluster/agent-events",
      options: {
        auth: false,
        // Unparsed NDJSON forwarded verbatim; maxBytes turns an oversized batch into a visible 413 instead of a buffered undeliverable body.
        payload: { parse: false, maxBytes: MAX_BODY_BYTES },
      },
      handler: async (request, h) => {
        enforceAnyBearer(request.headers, deps.acceptedTokens());

        // Awaited so a full queue applies backpressure to the pod rather than accumulating unsent batches in memory.
        await deps.emit({ kind: "telemetry", body: rawBody(request) });

        return h.response().code(202);
      },
    },
  ];
}
