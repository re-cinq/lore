// The event-driven walk's liveness bound (spec 6-dark-factory FR6): sweeps dropped/dead-lettered transitions and stalled queue/claim/timeout states every minute for both graph and single-CR runs; never owns a claimed single-CR's execution timeout — the watcher settles that from the terminal event.

import {
  capacityFor,
  unclaimedDetail,
} from "@re-cinq/lore-shared/project/cluster-agents/capacity.js";
import type { ClusterAgent } from "@re-cinq/lore-shared/models/cluster-agent.js";
import { resolveRunGraph } from "@re-cinq/lore-assembly-lines";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { advanceLine } from "./advance-line.js";
import { finishLine } from "./finish-line.js";
import type { NodeEventDeps } from "./node-event-handler.js";
import { reapGraphlessRun } from "./graphless-run-sweep.js";
import {
  recoverOpenNode,
  type ReapContext,
  type ReapOutcome,
} from "./apply-node-recovery.js";

export {
  decideNodeRecovery,
  type NodeRecovery,
  type NodeRecoveryInput,
} from "./node-recovery-decision.js";

/** Reaper deps: the walk deps plus the backing-task status read used to sweep a crash-orphaned single-CR (definition-less) run row. */
export interface AssemblyLineReaperDeps extends NodeEventDeps {
  taskStatus: (taskId: string) => Promise<string | null>;
  /** FR4's offline sweep: marks agents silent past the threshold offline; optional, sweeps nothing without a registry. */
  offlineClusterAgents?: (cutoff: Date) => Promise<Set<string>>;
  /** The audit writer for `cluster_agent_offline` requeues. */
  audit?: (entry: {
    event_type: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  /** The central cluster's registered agent id, for {@link agentCrVisible}; null (unregistered) leaves only legacy `running` rows visible. */
  centralClusterAgentId: () => Promise<string | null>;
  /** The registry, read once per sweep so a queue-timeout can say WHY nobody claimed the row (absent/paused/offline/ignoring); optional. */
  listClusterAgents?: () => Promise<ClusterAgent[]>;
  /** The sweep's clock. Injected so a test can age a queue without sleeping. */
  now?: () => Date;
  /** The queue-wait bound, defaulting to {@link stationQueueWaitMs}. */
  queueWaitMs?: number;
}

const DEFAULT_CENTRAL_CLUSTER_AGENT_NAME = "central";

/** The central agent's registry name (`LORE_CENTRAL_CLUSTER_AGENT_NAME`). */
export function centralClusterAgentName(): string {
  return (
    process.env.LORE_CENTRAL_CLUSTER_AGENT_NAME ??
    DEFAULT_CENTRAL_CLUSTER_AGENT_NAME
  );
}

const MINUTE_MS = 60_000;
const QUEUED_LIMIT_MINUTES = 30;
/** How long a `queued` row may wait for a claim before it fails terminally. */
const DEFAULT_QUEUE_WAIT_MINUTES = 30;

/** Silence past this marks a cluster-agent offline — ten missed 30s beats. */
export const OFFLINE_THRESHOLD_MS = 5 * MINUTE_MS;

/** The queue-wait bound (`LORE_STATION_QUEUE_WAIT_MINUTES`, default 30m). */
export function stationQueueWaitMs(): number {
  const minutes = Number(process.env.LORE_STATION_QUEUE_WAIT_MINUTES);

  return (minutes > 0 ? minutes : DEFAULT_QUEUE_WAIT_MINUTES) * MINUTE_MS;
}

/** finishLine (not bare finish) so the detect fan-out's pre-created job_run row is settled failed rather than left running forever. */
async function failLongQueuedLine(
  row: AssemblyRunRecord,
  deps: AssemblyLineReaperDeps,
  nowMs: number,
): Promise<number> {
  if (nowMs - row.createdAt.getTime() <= QUEUED_LIMIT_MINUTES * MINUTE_MS) {
    return 0;
  }
  await finishLine(row, "error", "assembly_line.start never completed", deps);

  return 1;
}

/** One open line: no graph means the single-CR sweep, a still-queued line may have missed its start, an open node gets a recovery verdict, and none of the above means the walk simply stopped and is re-advanced. */
async function reapOpenRun(
  row: AssemblyRunRecord,
  ctx: ReapContext,
): Promise<ReapOutcome> {
  // Same rule the walk follows (FR6.38): reaping against a since-edited graph would resolve a node the run never had.
  const graph = await resolveRunGraph(row, ctx.deps.definitions);

  if (!graph) {
    return await reapGraphlessRun(row, ctx);
  }

  if (row.status === "queued") {
    const failed = await failLongQueuedLine(row, ctx.deps, ctx.nowMs);

    return failed > 0 ? "failed-queued" : null;
  }
  const nodes = await ctx.deps.assemblyRuns.listStationRuns(row.id);
  const openNode = nodes.find((n) => n.outcome === null);

  if (!openNode) {
    await advanceLine(row.id, ctx.deps);

    return "advanced";
  }
  const node = graph.nodes.find((n) => n.id === openNode.nodeId);

  return node ? await recoverOpenNode({ row, node, openNode }, ctx) : null;
}

function reapNowMs(deps: AssemblyLineReaperDeps): number {
  return (deps.now?.() ?? new Date()).getTime();
}

function reapQueueWaitMs(deps: AssemblyLineReaperDeps): number {
  return deps.queueWaitMs ?? stationQueueWaitMs();
}

async function reapOfflineAgents(
  deps: AssemblyLineReaperDeps,
  nowMs: number,
): Promise<Set<string>> {
  return (
    (await deps.offlineClusterAgents?.(
      new Date(nowMs - OFFLINE_THRESHOLD_MS),
    )) ?? new Set<string>()
  );
}

async function reapClusterAgents(
  deps: AssemblyLineReaperDeps,
): Promise<ClusterAgent[]> {
  return (await deps.listClusterAgents?.()) ?? [];
}

/** Everything one tick reads once and every line then shares: the clock, the queue budget, which clusters are dead, and the capacity picture that explains an unclaimed node. */
async function buildReapContext(
  deps: AssemblyLineReaperDeps,
): Promise<ReapContext> {
  const nowMs = reapNowMs(deps);
  const queueWaitMs = reapQueueWaitMs(deps);
  const offlineAgents = await reapOfflineAgents(deps, nowMs);
  // AFTER the offline sweep, which mutates what this reads — reading first would misreport a cluster that just died as "capable ... it may be wedged".
  const clusterAgents = await reapClusterAgents(deps);

  return {
    deps,
    nowMs,
    queueWaitMs,
    offlineAgents,
    centralClusterAgentId: await deps.centralClusterAgentId(),
    whyUnclaimed: (requiredTags: string[]): string =>
      unclaimedDetail({
        requiredTags,
        waitMinutes: queueWaitMs / MINUTE_MS,
        verdict: capacityFor(requiredTags, clusterAgents),
      }),
  };
}

/** One sweep over every open line; per-line failures are logged and skipped so a single bad row never wedges the tick. */
export async function assemblyLineReaperJob(
  deps: AssemblyLineReaperDeps,
): Promise<string> {
  const open = await deps.assemblyRuns.listOpen();
  const ctx = await buildReapContext(deps);
  const tally = new Map<ReapOutcome, number>();

  for (const row of open) {
    try {
      const outcome = await reapOpenRun(row, ctx);

      tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
    } catch (err) {
      console.error(
        `[assembly-run-reaper] ${row.blueprintName}/${row.id}: ${(err as Error).message}`,
      );
    }
  }
  const count = (outcome: ReapOutcome): number => tally.get(outcome) ?? 0;

  return `resolved ${count("resolved")}, requeued ${count("requeued")}, timed out ${count("timeout")}, queue-timed-out ${count("queue-timeout")}, failed-queued ${count("failed-queued")}, re-advanced ${count("advanced")}, swept-single-cr ${count("swept")} across ${open.length} open line(s)`;
}
