// Agent-node assembly line handler (ADR-031 D4, #686 Wave 2). The cluster path runs the assembly line
// assembly line Floor-side; an `agent` node no longer spawns claude in-pod (claude-code-handler)
// but DISPATCHES one Agent custom resource, then polls its status to terminal while
// heartbeating the branch lease (a run can take minutes — longer than executeAssemblyLine's
// per-node refresh). The dispatch / poll / heartbeat / sleep are injected ports so the
// loop + outcome mapping are deterministically testable.

import type {
  NodeHandler,
  NodeResult,
  NodeContext,
} from "./assembly-line-executor.js";
import type { AssemblyLineNode } from "./loader.js";

/** The slice of an Agent's status the handler reacts to. */
export interface AgentNodeStatus {
  phase?: string;
  output?: string;
  failureReason?: string;
}

export interface AgentNodeDeps {
  /** Dispatch the Agent CR for this node (builds the spec from node + ctx). */
  launch: (node: AssemblyLineNode, ctx: NodeContext) => Promise<void>;
  /** Current status of THIS node's Agent, or null if not found yet. Keyed by node id
   *  because the Floor-side assembly line dispatches a separate Agent CR per agent-node (#686). */
  poll: (assemblyLineId: string, nodeId: string) => Promise<AgentNodeStatus | null>;
  /** Refresh the branch lease so a long run doesn't lapse mid-node. */
  heartbeat: (branchName: string, nodeId: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_POLLS = 360; // ~1h at 10s

const isTerminalPhase = (phase?: string): boolean =>
  phase === "Succeeded" || phase === "Failed";

/** Review nodes ask the agent to print exactly one REVIEW_RESULT line. */
export function parseReviewVerdict(output?: string): "success" | "changes_requested" | null {
  if (!output) return null;
  if (/REVIEW_RESULT:\s*CHANGES_REQUESTED/i.test(output)) return "changes_requested";
  if (/REVIEW_RESULT:\s*APPROVED/i.test(output)) return "success";
  return null;
}

/** Map a terminal Agent status to a node outcome. A Succeeded review node whose output
 *  requested changes yields `changes_requested`; everything else Succeeded is `success`. */
export function agentNodeOutcome(status: AgentNodeStatus): NodeResult {
  if (status.phase === "Failed") {
    return {
      outcome: "failed",
      extras: {
        "Lore-Validation-Status": "agent-failed",
        "Lore-Validation-Summary": (status.failureReason ?? "agent run failed").substring(0, 300),
      },
    };
  }
  if (parseReviewVerdict(status.output) === "changes_requested") {
    return { outcome: "changes_requested" };
  }
  return { outcome: "success" };
}

export function createAgentNodeHandler(deps: AgentNodeDeps): NodeHandler {
  const intervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = deps.maxPolls ?? DEFAULT_MAX_POLLS;

  return async (node: AssemblyLineNode, ctx: NodeContext): Promise<NodeResult> => {
    await deps.launch(node, ctx);
    for (let poll = 0; poll < maxPolls; poll++) {
      await deps.heartbeat(ctx.branchName, node.id);
      const status = await deps.poll(ctx.assemblyLineId, node.id);
      if (status && isTerminalPhase(status.phase)) {
        return agentNodeOutcome(status);
      }
      await deps.sleep(intervalMs);
    }
    return {
      outcome: "failed",
      extras: {
        "Lore-Validation-Status": "agent-timeout",
        "Lore-Validation-Summary": `agent node "${node.id}" did not reach a terminal phase`,
      },
    };
  };
}
