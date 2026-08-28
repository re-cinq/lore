/**
 * The agent-telemetry relay: run pods POST their NDJSON here, and this cluster
 * forwards it centrally through the event proxy.
 *
 * A satellite CAN already post straight to the Floor: FR8 shipped a public
 * `lore-agent-events` ingress and the per-agent credential its pods present
 * there. This is an alternative to that path, not a replacement for a missing
 * one, and it buys three things the direct sink cannot:
 *
 *   - the batch is QUEUED and retried on the proxy's ladder, where a pod
 *     posting directly loses a batch to any blip — it has no queue and no
 *     second attempt
 *   - a refused credential re-registers and retries, the same rotation handling
 *     every other report from this cluster gets
 *   - the run pods need no public egress at all, so a cluster can close that
 *     hole and still be observable
 *
 * The cost is one hop and one more thing to run. A satellite that would rather
 * post straight out keeps `agentEventsUrl` pointed at the public ingress.
 *
 * The body is forwarded VERBATIM. This service does not parse stream-json, does
 * not know what a turn is, and must not learn: the Floor owns that projection,
 * and a relay that reshapes its payload is a second parser to keep in sync.
 */

import type { ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  extractBearer,
  secretEquals,
} from "@re-cinq/lore-shared/http/bearer.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import type { Emit } from "@re-cinq/lore-shared/project/events/event-input-port.js";

/** Matches the Floor's own sink cap, so this relay refuses exactly what the
 *  far end would have refused rather than accepting a body it cannot deliver. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface AgentEventsDeps {
  emit: Emit;
  /**
   * The credentials this cluster will accept, resolved PER REQUEST.
   *
   * A thunk because the satellite's per-agent token rotates on every
   * re-registration; a captured list would start refusing its own pods the
   * moment it rotated. Entries may be undefined — a central cluster has no
   * per-agent token and a satellite has no bus-wide one, and each simply does
   * not offer the credential it does not hold.
   */
  acceptedTokens: () => Array<string | undefined>;
}

/**
 * Accept the request only if it presents one of this cluster's credentials.
 *
 * Every comparison runs even after a match, so the number of comparisons does
 * not depend on WHICH token matched — the same reason `secretEquals` exists.
 */
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
        // Unparsed: the payload is NDJSON, not JSON, and it is forwarded
        // verbatim. `maxBytes` is what turns an oversized batch into a 413 the
        // pod can see, rather than a body this process buffers and then cannot
        // deliver.
        payload: { parse: false, maxBytes: MAX_BODY_BYTES },
      },
      handler: async (request, h) => {
        enforceAnyBearer(request.headers, deps.acceptedTokens());

        // Awaited, so a full queue applies backpressure to the POD rather than
        // accumulating unsent batches in this process's memory. A busy run
        // waits; it does not silently lose its transcript.
        await deps.emit({ kind: "telemetry", body: rawBody(request) });

        return h.response().code(202);
      },
    },
  ];
}
