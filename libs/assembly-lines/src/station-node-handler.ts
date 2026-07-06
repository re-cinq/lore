// Station-node assembly line handler (ADR-031 D4, extended to every node type).
// The Floor-side walk dispatches ONE Agent CR per node — LLM agents and
// deterministic stations alike — then polls its status to terminal while
// heartbeating the branch lease. Dispatch / poll / heartbeat / sleep are
// injected ports so the loop + outcome mapping are deterministically testable.
//
// Outcome precedence on Succeeded: the station contract's LORE_NODE_RESULT line
// → the agent review REVIEW_RESULT line → success. A CR phase of Failed (crash,
// non-zero exit, Job deadline) is an infrastructure failure, distinct from a
// station reporting outcome "failed" as its normal result.

import type {
  NodeHandler,
  NodeResult,
  NodeContext,
  StageOutcome,
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
   *  because the Floor-side assembly line dispatches a separate Agent CR per node (#686). */
  poll: (assemblyLineId: string, nodeId: string) => Promise<AgentNodeStatus | null>;
  /** Refresh the branch lease so a long run doesn't lapse mid-node. */
  heartbeat: (branchName: string, nodeId: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_POLLS = 360; // ~1h at 10s

/** Waited past the pod's own hard deadline so its Failed is observed, not raced. */
const TIMEOUT_BUFFER_MINUTES = 2;

const OUTCOMES = new Set<StageOutcome>(["success", "changes_requested", "failed"]);

const isTerminalPhase = (phase?: string): boolean =>
  phase === "Succeeded" || phase === "Failed";

/** Review nodes ask the agent to print exactly one REVIEW_RESULT line. */
export function parseReviewVerdict(output?: string): "success" | "changes_requested" | null {
  if (!output) return null;
  if (/REVIEW_RESULT:\s*CHANGES_REQUESTED/i.test(output)) return "changes_requested";
  if (/REVIEW_RESULT:\s*APPROVED/i.test(output)) return "success";
  return null;
}

/**
 * The station contract's terminal line: `LORE_NODE_RESULT: {"outcome": ...,
 * "extras": {...}}`. Null on absence or any malformation — callers fall back to
 * the older signals rather than failing the node over a formatting slip.
 */
export function parseNodeResult(output?: string): NodeResult | null {
  const match = output?.match(/LORE_NODE_RESULT:\s*(\{.*\})/);
  if (!match) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const { outcome, extras } = payload as { outcome?: string; extras?: Record<string, unknown> };
  if (!OUTCOMES.has(outcome as StageOutcome)) return null;
  const stringExtras: Record<string, string> = {};
  for (const [key, value] of Object.entries(extras ?? {})) {
    if (typeof value === "string") stringExtras[key] = value;
  }
  return { outcome: outcome as StageOutcome, extras: stringExtras };
}

const failureKind = (node: AssemblyLineNode): string =>
  node.type === "agent" ? "agent" : "station";

/** Map a terminal Agent status to the node outcome (see precedence above). */
export function stationNodeOutcome(node: AssemblyLineNode, status: AgentNodeStatus): NodeResult {
  if (status.phase === "Failed") {
    return {
      outcome: "failed",
      extras: {
        "Lore-Validation-Status": `${failureKind(node)}-failed`,
        "Lore-Validation-Summary": (
          status.failureReason ?? `${failureKind(node)} run failed`
        ).substring(0, 300),
      },
    };
  }
  const stationResult = parseNodeResult(status.output);
  if (stationResult) return stationResult;
  if (parseReviewVerdict(status.output) === "changes_requested") {
    return { outcome: "changes_requested" };
  }
  return { outcome: "success" };
}

export function createStationNodeHandler(deps: AgentNodeDeps): NodeHandler {
  const intervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const defaultMaxPolls = deps.maxPolls ?? DEFAULT_MAX_POLLS;

  return async (node: AssemblyLineNode, ctx: NodeContext): Promise<NodeResult> => {
    // A node-level timeout bounds the wait itself; the pod's hard stop is the
    // referenced Station's deadline, so wait a little longer than the node asks.
    const maxPolls = node.timeout_minutes
      ? Math.ceil(((node.timeout_minutes + TIMEOUT_BUFFER_MINUTES) * 60_000) / intervalMs)
      : defaultMaxPolls;

    await deps.launch(node, ctx);
    for (let poll = 0; poll < maxPolls; poll++) {
      await deps.heartbeat(ctx.branchName, node.id);
      const status = await deps.poll(ctx.assemblyLineId, node.id);
      if (status && isTerminalPhase(status.phase)) {
        return stationNodeOutcome(node, status);
      }
      await deps.sleep(intervalMs);
    }
    return {
      outcome: "failed",
      extras: {
        "Lore-Validation-Status": `${failureKind(node)}-timeout`,
        "Lore-Validation-Summary": `${failureKind(node)} node "${node.id}" did not reach a terminal phase`,
      },
    };
  };
}

/** Back-compat: an agent node is just a station whose pod runs an LLM CLI. */
export const createAgentNodeHandler = createStationNodeHandler;

/** Back-compat mapping for agent nodes (node-less signature kept for existing callers). */
export function agentNodeOutcome(status: AgentNodeStatus): NodeResult {
  return stationNodeOutcome({ id: "agent", type: "agent" }, status);
}
