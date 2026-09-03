// What a terminal Agent CR's status says.
//
// Here rather than in `libs/assembly-lines` because it is now a WIRE shape: the
// cluster agent reads it off the CR and serves it, the Floor consumes it over
// HTTP (or, since the terminal event carries it directly, without a second
// round trip at all — see `project/events/k8s-map.ts`), and assembly-lines
// interprets it. That package depends on this one, so the declaration has to
// sit at the bottom for all three to share it.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";

export interface AgentNodeStatus {
  phase?: string;
  output?: string;
  failureReason?: string;
  /**
   * The agent's OWN terminal error text, lifted off the raw NDJSON stream before
   * anything unwrapped it (`terminalErrorText`). It has to be carried separately
   * because `output` is normalized at the read boundary, and the unwrapped text
   * no longer parses as a stream — so a reader downstream of the unwrap could
   * only see the Job-level `failureReason`, which says `BackoffLimitExceeded`
   * however the agent actually died.
   */
  errorText?: string;
}

/**
 * Pure: the status an EXISTING Agent CR reports.
 *
 * A CR the controller has not stamped yet is BORN, not absent — so it answers
 * `Pending` rather than null. Collapsing the two made the reaper read a live
 * just-launched pod as "crashed between the row insert and the launch" and
 * relaunch over it every 60s, re-provisioning its recipe clone from a spec that
 * had lost the conversation (#1466). Null is reserved for a 404 — callers that
 * read a CR that may not exist (e.g. `kube-agent-api.ts`'s `getStatus`) apply
 * that convention themselves; this function only ever sees a CR that exists.
 */
export function statusFromAgentCr(cr: AgentCr): AgentNodeStatus {
  const status = cr.status;

  if (!status) {
    return { phase: "Pending" };
  }

  return {
    phase: status.phase,
    output: status.output,
    failureReason: status.failureReason,
  };
}
