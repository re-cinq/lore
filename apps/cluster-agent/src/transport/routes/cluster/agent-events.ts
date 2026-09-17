// Agent-telemetry relay: run pods POST NDJSON here, forwarded VERBATIM (never parsed) centrally through the event proxy — queued/retried, no public egress needed, an alternative to FR8's direct ingress.

import type { ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { secretEquals } from "@re-cinq/lore-shared/lib/secret-equals.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import type { Emit } from "@re-cinq/lore-shared/project/events/event-input-port.js";
import { MAX_AGENT_EVENTS_BODY_BYTES } from "@re-cinq/lore-shared/http/body-limits.js";
import { unparsedBodyUpTo } from "@re-cinq/lore-shared/http/route-options.js";

export interface AgentEventsDeps {
  emit: Emit;
  /** The credentials this cluster will accept, resolved PER REQUEST — a thunk because the per-agent token rotates on every re-registration. */
  acceptedTokens: () => Array<string | undefined>;
}

export function agentEventsRoutes(deps?: AgentEventsDeps): ServerRoute[] {
  if (!deps) {
    return [];
  }

  return [relayRoute(deps)];
}

/** `POST /api/cluster/agent-events` — the NDJSON telemetry relay. Called by this cluster's run pods, which post their claude stream-json here instead of the public ingress; the body is forwarded VERBATIM through the event proxy to the Floor. */
function relayRoute(deps: AgentEventsDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster/agent-events",
    // Unparsed NDJSON forwarded verbatim; the ceiling turns an oversized batch into a visible 413 instead of a buffered undeliverable body.
    options: unparsedBodyUpTo(MAX_AGENT_EVENTS_BODY_BYTES),
    handler: async (request, h) => {
      enforceAnyBearer(request.headers, deps.acceptedTokens());

      // Awaited so a full queue applies backpressure to the pod rather than accumulating unsent batches in memory.
      await deps.emit({ kind: "telemetry", body: rawBody(request) });

      return h.response().code(202);
    },
  };
}

/** Accepts one of this cluster's credentials; every comparison runs even after a match, for the reason `secretEquals` exists. */
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

  enforceTrue(
    presented && matchesAny(presented, configured),
    apiError(401),
    "missing or invalid bearer token — run pods authenticate with this cluster's agent-events credential",
  );
}

// Whether the presented token is one of ours. Every comparison runs even after a match — the same reason `secretEquals` exists: bailing early leaks, through timing, which credential matched.
function matchesAny(presented: string, configured: string[]): boolean {
  let found = false;

  for (const token of configured) {
    found = secretEquals(presented, token) || found;
  }

  return found;
}
