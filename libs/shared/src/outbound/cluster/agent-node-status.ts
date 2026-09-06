// Wire shape for terminal Agent CR status; in shared/cluster not libs/assembly-lines because the latter depends on this.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";

export interface AgentNodeStatus {
  phase?: string;
  output?: string;
  failureReason?: string;
  /** Agent's terminal error from raw NDJSON; carried separately because output is normalized at read boundary. */
  errorText?: string;
}

/** Pure: status an EXISTING Agent CR reports; BORN returns Pending not null (#1466); Null reserved for 404. */
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
