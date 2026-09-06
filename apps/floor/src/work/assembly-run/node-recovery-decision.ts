// The reaper's pure per-open-node recovery decision: given a node row's lifecycle status, its age on the claim clock, and — only when visible — the CR's live status, decide what should happen to it.

import {
  isHumanStation,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";

const MINUTE_MS = 60_000;

/** Parity with the old poll loop's ~1h default (DEFAULT_MAX_POLLS) . */
export const DEFAULT_TIMEOUT_MINUTES = 60;
const TIMEOUT_BUFFER_MINUTES = 2;
/** Grace before an absent CR is trusted to mean "crashed before launch" — the row is written before the CR create, so a tick can race an in-flight provision (mirrors the planning reaper's FR-10.4 grace). */
const NODE_STARTUP_GRACE_MS = 2 * MINUTE_MS;

export type NodeRecovery =
  | { kind: "resolve"; status: AgentNodeStatus }
  | { kind: "requeue" }
  | { kind: "requeue-offline" }
  | { kind: "timeout" }
  | { kind: "queue-timeout" }
  | { kind: "wait" };

/** Pure per-open-node decision inputs: the node row's lifecycle status, its age on the claim clock, and — only when visible — the CR's live status. */
export interface NodeRecoveryInput {
  node: StationRunRecord;
  timeoutMinutes: number | undefined;
  /** The CR's live status; the sweep reads it only for {@link agentCrVisible} rows, else passes null without asking the cluster. */
  status: AgentNodeStatus | null;
  /** The definition's node type. `wait` nodes have no budget — see below. */
  nodeType?: string;
  /** Precomputed {@link agentCrVisible} — whether null `status` means "the CR is gone" rather than "we never looked". */
  crVisible: boolean;
  /** The claiming cluster-agent is marked `offline` (FR4): its claim is lost, not stuck, so it requeues without any timeout precondition. */
  claimantOffline?: boolean;
  queueWaitMs: number;
  nowMs: number;
}

/** A node whose worker is a HUMAN is never stuck, it is parked — "how long may a person take to answer" has no defensible number, so no budget applies at all. */
function decideHumanWait(input: NodeRecoveryInput): NodeRecovery | null {
  return isHumanStation(input.nodeType) ? { kind: "wait" } : null;
}

/** A `queued` row has no CR/claimant to interrogate; past the queue wait it fails terminally naming its tags. */
function decideQueuedOutcome(input: NodeRecoveryInput): NodeRecovery | null {
  if (input.node.status !== "queued") {
    return null;
  }

  return input.nowMs - input.node.startedAt.getTime() > input.queueWaitMs
    ? { kind: "queue-timeout" }
    : { kind: "wait" };
}

/** A claim held by a DEAD cluster requeues immediately — the 5-minute offline threshold already absorbed transient silence. */
function decideOfflineRequeue(input: NodeRecoveryInput): NodeRecovery | null {
  return input.node.status === "claimed" && input.claimantOffline
    ? { kind: "requeue-offline" }
    : null;
}

/** The lifecycle-only verdicts, tried before anything that needs the CR's live status. */
function decideEarlyOutcome(input: NodeRecoveryInput): NodeRecovery | null {
  const checks = [decideHumanWait, decideQueuedOutcome, decideOfflineRequeue];

  for (const check of checks) {
    const recovery = check(input);

    if (recovery) {
      return recovery;
    }
  }

  return null;
}

/** A claimed row's budget runs from the claim so queue-wait time isn't charged against execution; pre-flip `running` rows have no claimedAt and measure from startedAt. */
function budgetClock(input: NodeRecoveryInput): {
  executionStartMs: number;
  expired: boolean;
} {
  const budgetMs =
    ((input.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) +
      TIMEOUT_BUFFER_MINUTES) *
    MINUTE_MS;
  const executionStartMs = (
    input.node.claimedAt ?? input.node.startedAt
  ).getTime();

  return {
    executionStartMs,
    expired: input.nowMs - executionStartMs > budgetMs,
  };
}

/** A row claimed by a SATELLITE: its CR can't be read from here, so its only signal is the budget (liveness is checked outside this function). */
function decideInvisibleCrOutcome(
  input: NodeRecoveryInput,
  expired: boolean,
): NodeRecovery | null {
  if (input.crVisible) {
    return null;
  }

  return expired ? { kind: "timeout" } : { kind: "wait" };
}

function decideResolvedOutcome(
  status: AgentNodeStatus | null,
): NodeRecovery | null {
  if (status?.phase === "Succeeded" || status?.phase === "Failed") {
    return { kind: "resolve", status };
  }

  return null;
}

function decideExpiredTimeout(expired: boolean): NodeRecovery | null {
  return expired ? { kind: "timeout" } : null;
}

/** A node dispatched to the POOLED SERVICE has no CR (published on the bus); requeueing it would duplicate work already in flight, so it only times out like anything else. */
function decidePooledServiceWait(node: StationRunRecord): NodeRecovery | null {
  return node.agentCrName === null ? { kind: "wait" } : null;
}

/** Absence (a 404) is the crash-between-claim-and-CR case, requeued after the startup grace runs from the execution clock (claim time), not enqueue time, to avoid requeuing a CR still provisioning. */
function decideAbsentCrOutcome(
  status: AgentNodeStatus | null,
  nowMs: number,
  executionStartMs: number,
): NodeRecovery | null {
  if (status !== null) {
    return null;
  }

  return nowMs - executionStartMs < NODE_STARTUP_GRACE_MS
    ? { kind: "wait" }
    : { kind: "requeue" };
}

/** The CR-status-dependent verdicts, tried once the row has cleared the lifecycle-only checks. */
function decideCrOutcome(input: NodeRecoveryInput): NodeRecovery {
  const { executionStartMs, expired } = budgetClock(input);
  const invisible = decideInvisibleCrOutcome(input, expired);

  if (invisible) {
    return invisible;
  }
  const checks = [
    () => decideResolvedOutcome(input.status),
    () => decideExpiredTimeout(expired),
    () => decidePooledServiceWait(input.node),
    () => decideAbsentCrOutcome(input.status, input.nowMs, executionStartMs),
  ];

  for (const check of checks) {
    const recovery = check();

    if (recovery) {
      return recovery;
    }
  }

  return { kind: "wait" };
}

/** Pure per-open-node decision from the node row's lifecycle status, its age on the claim clock, and — only when visible — the CR's live status. */
export function decideNodeRecovery(input: NodeRecoveryInput): NodeRecovery {
  return decideEarlyOutcome(input) ?? decideCrOutcome(input);
}
