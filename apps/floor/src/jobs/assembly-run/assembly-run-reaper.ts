// The event-driven walk's liveness bound (spec 6-dark-factory FR6; model:
// feature-planning-reaper). Dedupe rows make reconcile re-emits permanent no-ops,
// so a dropped/dead-lettered transition recovers ONLY here. Every open line either
// progresses or terminally fails with a reason — bounded, every minute:
//
//   - open node, CR terminal      → resolve its real outcome (dropped event;
//                                   only for rows whose CR THIS Floor can see)
//   - claimed node, CR missing    → requeue the same row (crash between claim
//                                   and CR create) once the startup grace passes
//   - node queued past the wait   → fail terminally, naming its required_tags
//   - open node past its timeout  → fail `<kind>-timeout` and advance (budget
//                                   runs from claimed_at when a claim exists)
//   - row queued > 30 min         → fail (assembly_line.start never completed)
//   - row running, no open node   → advance (crash between transitions; replay
//                                   converges on the next launch/finish)
//   - single-CR (definition-less) row, backing task terminal → close from status

import { nodeTimeoutMinutes, stationBudgetFor } from "./node-timeout.js";
import {
  isHumanStation,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import { resolveRunGraph } from "@re-cinq/lore-assembly-lines";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { advanceLine, finishLine } from "./advance.js";
import { agentCrVisible } from "./cr-visibility.js";
import { finishNodeTerminal, normalizeAgentStatus } from "./node-terminal.js";
import { runOutcomeFromTaskStatus } from "../watcher/agent-watcher-logic.js";
import {
  deliverTerminalArtifacts,
  type NodeEventDeps,
} from "./node-event-handler.js";

/** Reaper deps: the walk deps plus the backing-task status read used to sweep a
 *  crash-orphaned single-CR (definition-less) run row. */
export interface AssemblyLineReaperDeps extends NodeEventDeps {
  taskStatus: (taskId: string) => Promise<string | null>;
  /** FR4's offline sweep: mark agents silent past the threshold offline and
   *  return every offline agent id. Optional — a composition without a
   *  registry (tests, local runs) sweeps nothing. */
  offlineClusterAgents?: (cutoff: Date) => Promise<Set<string>>;
  /** The audit writer for `cluster_agent_offline` requeues. */
  audit?: (entry: {
    event_type: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  /**
   * The central cluster's registered agent id, for {@link agentCrVisible}.
   * Resolved per sweep — the id is minted at registration, so a static env
   * var cannot know it. Null (registry empty, central agent not yet
   * registered) leaves only legacy `running` rows visible, which is exactly
   * the pre-claim-path behaviour.
   */
  centralClusterAgentId: () => Promise<string | null>;
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
/** Parity with the old poll loop's ~1h default (DEFAULT_MAX_POLLS) . */
const DEFAULT_TIMEOUT_MINUTES = 60;
const TIMEOUT_BUFFER_MINUTES = 2;
const QUEUED_LIMIT_MINUTES = 30;
/**
 * How long after a node's row is minted an absent CR is not yet trusted to mean
 * "crashed before launch". The row is written BEFORE the CR create, so a tick can
 * legitimately land between them and race an in-flight provision. Mirror of the
 * planning reaper's FR-10.4 grace, and generous enough to absorb a flaky kube read.
 */
const NODE_STARTUP_GRACE_MS = 2 * MINUTE_MS;
/** How long a `queued` row may wait for a claim before it fails terminally. */
const DEFAULT_QUEUE_WAIT_MINUTES = 30;

/** Silence past this marks a cluster-agent offline — ten missed 30s beats. */
export const OFFLINE_THRESHOLD_MS = 5 * MINUTE_MS;

/** The queue-wait bound (`LORE_STATION_QUEUE_WAIT_MINUTES`, default 30m). */
export function stationQueueWaitMs(): number {
  const minutes = Number(process.env.LORE_STATION_QUEUE_WAIT_MINUTES);

  return (minutes > 0 ? minutes : DEFAULT_QUEUE_WAIT_MINUTES) * MINUTE_MS;
}

export type NodeRecovery =
  | { kind: "resolve"; status: AgentNodeStatus }
  | { kind: "requeue" }
  | { kind: "requeue-offline" }
  | { kind: "timeout" }
  | { kind: "queue-timeout" }
  | { kind: "wait" };

/** Pure per-open-node decision from the node row's lifecycle status, its age on
 *  the claim clock, and — only when visible — the CR's live status. */
export function decideNodeRecovery(input: {
  node: StationRunRecord;
  timeoutMinutes: number | undefined;
  /** The CR's live status. The sweep reads it ONLY for {@link agentCrVisible}
   *  rows; for the rest it passes null without asking the cluster. */
  status: AgentNodeStatus | null;
  /** The definition's node type. `wait` nodes have no budget — see below. */
  nodeType?: string;
  /** Precomputed {@link agentCrVisible} — whether the null in `status` means
   *  "the CR is gone" rather than "we never looked". */
  crVisible: boolean;
  /** The claiming cluster-agent is marked `offline` (FR4): its claim is lost,
   *  not stuck, so it requeues without any timeout precondition. */
  claimantOffline?: boolean;
  queueWaitMs: number;
  nowMs: number;
}): NodeRecovery {
  // A node whose worker is a HUMAN is never stuck, it is parked. Every other node
  // has a budget because a pod that stops reporting has died; "how long may a person
  // take to answer" has no defensible number, so the budget does not apply at all
  // rather than being set very large and silently killing a feature next month.
  if (isHumanStation(input.nodeType)) {
    return { kind: "wait" };
  }

  // A `queued` row has no CR and no claimant — nothing to interrogate. Its only
  // bound is the queue wait: past it, no registered cluster-agent could (or
  // would) claim the run, and the row fails terminally naming its tags.
  if (input.node.status === "queued") {
    return input.nowMs - input.node.startedAt.getTime() > input.queueWaitMs
      ? { kind: "queue-timeout" }
      : { kind: "wait" };
  }

  // A claim held by a DEAD cluster requeues immediately — waiting out the
  // node budget would stall the line for work nobody is doing, and the
  // 5-minute offline threshold already absorbed transient silence.
  if (input.node.status === "claimed" && input.claimantOffline) {
    return { kind: "requeue-offline" };
  }
  const budgetMs =
    ((input.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) +
      TIMEOUT_BUFFER_MINUTES) *
    MINUTE_MS;
  // The execution clock: a claimed row's budget runs from the claim, so time
  // spent waiting for a capable cluster is not charged against execution.
  // Pre-flip `running` rows have no claimedAt and keep measuring from startedAt.
  const executionStartMs = (
    input.node.claimedAt ?? input.node.startedAt
  ).getTime();
  const expired = input.nowMs - executionStartMs > budgetMs;

  // A row claimed by a SATELLITE: its CR cannot be read from here, so its only
  // signals are the budget (a live agent past budget is a stuck node, not a
  // lost one) and — outside this function — the claiming agent's liveness.
  if (!input.crVisible) {
    return expired ? { kind: "timeout" } : { kind: "wait" };
  }

  if (input.status?.phase === "Succeeded" || input.status?.phase === "Failed") {
    return { kind: "resolve", status: input.status };
  }

  if (expired) {
    return { kind: "timeout" };
  }

  // A node dispatched to the POOLED SERVICE has no CR, and never had one: it was
  // published on the bus. Requeueing it would offer the cluster-agents work the
  // service is still holding — the pod and the queued delivery would BOTH run:
  // duplicate Issues, duplicate episodes. It is timed out above like anything
  // else, so a lost delivery still surfaces.
  if (input.node.agentCrName === null) {
    return { kind: "wait" };
  }

  // Absence — and only absence, a 404 — is the crash-between-claim-and-CR case:
  // requeue the same row so another claim takes it. An existing CR the
  // controller has not stamped reports `Pending` and falls through to `wait`.
  // A LEGACY `running` row (pre-flip push dispatch) whose CR is gone lands here
  // too: its dispatch_spec is null so no claim ever takes it, and the queue-wait
  // bound settles it — an acceptable deprecation for rows already in flight at
  // the cutover.
  // The grace runs on the execution clock: a row that queued for ten minutes
  // and was claimed five seconds ago is a CR still being provisioned, not a
  // crash — measuring from enqueue time would requeue it in a loop.
  if (input.status === null) {
    return input.nowMs - executionStartMs < NODE_STARTUP_GRACE_MS
      ? { kind: "wait" }
      : { kind: "requeue" };
  }

  return { kind: "wait" };
}

/** One sweep over every open line; per-line failures are logged and skipped so a
 *  single bad row never wedges the tick. */
export async function assemblyLineReaperJob(
  deps: AssemblyLineReaperDeps,
): Promise<string> {
  const open = await deps.assemblyRuns.listOpen();
  const nowMs = Date.now();
  const queueWaitMs = stationQueueWaitMs();
  const centralClusterAgentId = await deps.centralClusterAgentId();
  const offlineAgents =
    (await deps.offlineClusterAgents?.(
      new Date(nowMs - OFFLINE_THRESHOLD_MS),
    )) ?? new Set<string>();
  let resolved = 0;
  let requeued = 0;
  let timedOut = 0;
  let queueTimedOut = 0;
  let failedQueued = 0;
  let advanced = 0;
  let sweptSingleCr = 0;

  for (const row of open) {
    try {
      // Same rule the walk follows (FR6.38): reaping a run against a
      // since-edited graph would resolve a node the run never had.
      const graph = await resolveRunGraph(row, deps.definitions);

      if (!graph) {
        // Single-CR run record (FR6.8): normally the agent-watcher closes it, but
        // a crash between the task's post-handler status write and that close (or
        // a dropped terminal event past the reconcile window) leaves it open
        // forever. Sweep it: if the backing task is terminal, close the row from
        // its status; else leave it (the task is still in-flight).
        if (row.taskId) {
          const taskStatus = await deps.taskStatus(row.taskId);
          const terminal =
            taskStatus !== null &&
            !["running", "queued", "pending"].includes(taskStatus);

          if (terminal) {
            // finishLine (not finish) so the single-CR row's token is reclaimed
            // and, though single-CR rows carry no job_run_id, every terminal close
            // routes through one path.
            await finishLine(
              row,
              runOutcomeFromTaskStatus(taskStatus),
              undefined,
              deps,
            );
            sweptSingleCr++;
          }
        }
        continue;
      }

      if (row.status === "queued") {
        if (
          nowMs - row.createdAt.getTime() >
          QUEUED_LIMIT_MINUTES * MINUTE_MS
        ) {
          // finishLine so the detect fan-out's args.job_run_id is settled (failed)
          // — a bare finish would leave the pre-created job_run row running forever.
          await finishLine(
            row,
            "error",
            "assembly_line.start never completed",
            deps,
          );
          failedQueued++;
        }
        continue;
      }

      const nodes = await deps.assemblyRuns.listStationRuns(row.id);
      const openNode = nodes.find((n) => n.outcome === null);

      if (!openNode) {
        await advanceLine(row.id, deps);
        advanced++;
        continue;
      }

      const node = graph.nodes.find((n) => n.id === openNode.nodeId);

      if (!node) {
        continue;
      }

      const crVisible = agentCrVisible(openNode, centralClusterAgentId);
      // Never read CR status for a row this Floor cannot see — a `queued` row
      // has no CR yet, and a satellite's CR read answers null, which would
      // requeue (double-launch) work another cluster is running right now.
      const status =
        crVisible && openNode.agentCrName
          ? await deps.readAgentStatus(openNode.agentCrName)
          : null;
      const claimantOffline =
        openNode.clusterAgentId !== null &&
        offlineAgents.has(openNode.clusterAgentId);
      const recovery = decideNodeRecovery({
        claimantOffline,
        node: openNode,
        // The station's own budget, not the global sixty, when the YAML is
        // silent — every merge.yaml node is, and merge_step declares five.
        timeoutMinutes: nodeTimeoutMinutes({
          yaml: node.timeout_minutes,
          manifest: stationBudgetFor(node.type),
        }),
        status,
        nodeType: node.type,
        crVisible,
        queueWaitMs,
        nowMs,
      });

      if (recovery.kind === "resolve") {
        // A dropped event lands here instead — it owes the PR the same review and
        // check the event path would have posted, off the same resolved outcome.
        const status = normalizeAgentStatus(recovery.status);
        // ...and it owes the next node the artifacts this one produced. A dropped
        // event means THIS is the only door that will ever read this output, so an
        // artifact delivered on the event path and not here is a difference nobody
        // could predict from the run.
        const result = await deliverTerminalArtifacts(
          row,
          node,
          recovery.status,
          deps,
        );

        // ...and it owes operators the same alert. A billing outage recovered
        // through this slower door raised nothing at all before, so whether the
        // account-dry alarm fired depended on which door the event came through.
        if (result.outcome === "failed" && deps.alertBilling) {
          await deps.alertBilling(row.repo, node.type, status);
        }

        if (result.failureClass) {
          deps.llmGate?.trip(result.failureClass, result.failureDetail);
        }

        await finishNodeTerminal(
          {
            row,
            node,
            nodeId: openNode.nodeId,
            iteration: openNode.iteration,
            result,
            output: status.output,
          },
          deps,
        );
        resolved++;
      } else if (recovery.kind === "timeout") {
        const budget = node.timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES;

        await finishNodeTerminal(
          {
            row,
            node,
            nodeId: openNode.nodeId,
            iteration: openNode.iteration,
            // A node whose pod stopped reporting died of infrastructure, not of
            // the work — and saying so is the difference between a run somebody
            // can diagnose later and a bare `failed` with no story at all.
            result: {
              outcome: "failed",
              failureClass: "infra",
              failureDetail: `${node.type === "agent" ? "agent" : "station"} node timed out after ${budget} minutes without reporting`,
            },
          },
          deps,
        );
        timedOut++;
        console.warn(
          `[assembly-run-reaper] node ${openNode.nodeId} of ${row.id} timed out (${node.type === "agent" ? "agent" : "station"}-timeout)`,
        );
      } else if (recovery.kind === "queue-timeout") {
        await finishNodeTerminal(
          {
            row,
            node,
            nodeId: openNode.nodeId,
            iteration: openNode.iteration,
            // Naming the tags is the point: a line stalled because no registered
            // cluster carries `gpu` must say so, not report a generic timeout.
            result: {
              outcome: "failed",
              failureClass: "infra",
              failureDetail: `no registered cluster-agent claimed this run (required_tags: [${openNode.requiredTags.join(", ")}]) within ${queueWaitMs / MINUTE_MS}m`,
            },
          },
          deps,
        );
        queueTimedOut++;
        console.warn(
          `[assembly-run-reaper] node ${openNode.nodeId} of ${row.id} sat queued past ${queueWaitMs / MINUTE_MS}m unclaimed`,
        );
      } else if (recovery.kind === "requeue-offline") {
        // Same row back on the shelf; the audit entry is what makes a flapping
        // cluster diagnosable without database access (FR7 renders it).
        await deps.assemblyRuns.requeueStationRun(openNode.id);
        await deps.audit?.({
          event_type: "cluster_agent_offline",
          payload: {
            cluster_agent_id: openNode.clusterAgentId,
            station_run_id: openNode.stationRunId,
            assembly_run_id: row.id,
            node_id: openNode.nodeId,
            elapsed_since_claim_ms: openNode.claimedAt
              ? nowMs - openNode.claimedAt.getTime()
              : null,
          },
        });
        requeued++;
      } else if (recovery.kind === "requeue") {
        // Crash between claim and CR create: reset the SAME row to `queued` so
        // another claim takes it — no second builder, the armed dispatch spec
        // rides the row. (The old relaunch arm rebuilt and pushed a CR itself.)
        await deps.assemblyRuns.requeueStationRun(openNode.id);
        requeued++;
        console.warn(
          `[assembly-run-reaper] requeued node ${openNode.nodeId} of ${row.id} — its claim produced no CR within the startup grace`,
        );
      }
    } catch (err) {
      console.error(
        `[assembly-run-reaper] ${row.blueprintName}/${row.id}: ${(err as Error).message}`,
      );
    }
  }

  return `resolved ${resolved}, requeued ${requeued}, timed out ${timedOut}, queue-timed-out ${queueTimedOut}, failed-queued ${failedQueued}, re-advanced ${advanced}, swept-single-cr ${sweptSingleCr} across ${open.length} open line(s)`;
}
