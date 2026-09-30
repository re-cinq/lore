// A terminal node, recorded and advanced — shared by the node-event handler and the reaper so the dropped-event path records a visit the same way. The review lines, whose findings were posted from here, run on the external floor now, where posting is a station of its own.

import {
  agentStderrError,
  resultTextFromOutput,
  terminalErrorText,
  type AgentNodeStatus,
  type NodeResult,
} from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { finishNodeAndAdvance } from "./finish-node.js";
import type { AdvanceDeps } from "./advance-deps.js";

// Unwraps the Agent output envelope AND lifts the terminal error text before the raw stream is gone — reading after unwrap always returned null, which is why FR6.14's billing alert never fired (billing errors misread as Job-level BackoffLimitExceeded, #1455).
export function normalizeAgentStatus(status: AgentNodeStatus): AgentNodeStatus {
  if (status.output === undefined) {
    return status;
  }
  // Falls back through stderr because a boot crash has no result line — without it, the walk misread a permanent misconfig as retryable infra and burned a 25min retry (run 129235d4, 2026-08-28).
  const errorText =
    terminalErrorText(status.output) ??
    agentStderrError(status.output) ??
    status.errorText;
  const unwrapped = { ...status, output: resultTextFromOutput(status.output) };

  return errorText === undefined ? unwrapped : { ...unwrapped, errorText };
}

export interface NodeTerminalInput {
  row: AssemblyRunRecord;
  node: RunGraphNode;
  nodeId: string;
  iteration?: number;
  result: NodeResult;
  /** The node's agent text, already normalized by {@link normalizeAgentStatus}. */
  output?: string;
}

/** Record the outcome and advance — the walk refreshes the PR check. */
export async function finishNodeTerminal(
  input: NodeTerminalInput,
  deps: AdvanceDeps,
): Promise<void> {
  await finishNodeAndAdvance(
    {
      assemblyLineId: input.row.id,
      nodeId: input.nodeId,
      iteration: input.iteration,
      result: input.result,
    },
    deps,
  );
}
