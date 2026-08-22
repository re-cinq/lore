// The event-driven walk's liveness bound (spec 6-dark-factory FR6; model:
// feature-planning-reaper). Dedupe rows make reconcile re-emits permanent no-ops,
// so a dropped/dead-lettered transition recovers ONLY here. Every open line either
// progresses or terminally fails with a reason — bounded, every minute:
//
//   - open node, CR terminal      → resolve its real outcome (dropped event)
//   - open node, CR missing       → relaunch (crash between row insert and launch;
//                                   the deterministic name makes it a 409 no-op if
//                                   the CR actually exists) until the timeout
//   - open node past its timeout  → fail `<kind>-timeout` and advance
//   - row queued > 30 min         → fail (assembly_line.start never completed)
//   - row running, no open node   → advance (crash between transitions; replay
//                                   converges on the next launch/finish)
//   - single-CR (definition-less) row, backing task terminal → close from status

import {
  isHumanStation,
  stationNodeOutcome,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import { graphForRun } from "@re-cinq/lore-assembly-lines";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { advanceLine, finishLine, taskFromRow } from "./advance.js";
import { finishNodeTerminal, normalizeAgentStatus } from "./node-terminal.js";
import {
  nodeLaunchSpec,
  priorOutcomeOf,
  resolveNodeDispatch,
} from "./launch-spec.js";
import { runOutcomeFromTaskStatus } from "../watcher/agent-watcher-logic.js";
import type { NodeEventDeps } from "./node-event-handler.js";

/** Reaper deps: the walk deps plus the backing-task status read used to sweep a
 *  crash-orphaned single-CR (definition-less) run row. */
export interface AssemblyLineReaperDeps extends NodeEventDeps {
  taskStatus: (taskId: string) => Promise<string | null>;
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

export type NodeRecovery =
  | { kind: "resolve"; status: AgentNodeStatus }
  | { kind: "relaunch" }
  | { kind: "timeout" }
  | { kind: "wait" };

/** Pure per-open-node decision from the node row's age and the CR's live status. */
export function decideNodeRecovery(input: {
  node: StationRunRecord;
  timeoutMinutes: number | undefined;
  status: AgentNodeStatus | null;
  /** The definition's node type. `wait` nodes have no budget — see below. */
  nodeType?: string;
  nowMs: number;
}): NodeRecovery {
  // A node whose worker is a HUMAN is never stuck, it is parked. Every other node
  // has a budget because a pod that stops reporting has died; "how long may a person
  // take to answer" has no defensible number, so the budget does not apply at all
  // rather than being set very large and silently killing a feature next month.
  if (isHumanStation(input.nodeType)) {
    return { kind: "wait" };
  }
  const budgetMs =
    ((input.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) +
      TIMEOUT_BUFFER_MINUTES) *
    MINUTE_MS;
  const expired = input.nowMs - input.node.startedAt.getTime() > budgetMs;

  if (input.status?.phase === "Succeeded" || input.status?.phase === "Failed") {
    return { kind: "resolve", status: input.status };
  }

  if (expired) {
    return { kind: "timeout" };
  }

  // Absence — and only absence, a 404 — is the crash-between-row-and-launch case.
  // An existing CR the controller has not stamped reports `Pending` and falls
  // through to `wait` below.
  if (input.status === null) {
    return input.nowMs - input.node.startedAt.getTime() < NODE_STARTUP_GRACE_MS
      ? { kind: "wait" }
      : { kind: "relaunch" };
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
  let resolved = 0;
  let relaunched = 0;
  let timedOut = 0;
  let failedQueued = 0;
  let advanced = 0;
  let sweptSingleCr = 0;

  for (const row of open) {
    try {
      // Same rule the walk follows (FR6.38): reaping a run against a
      // since-edited graph would resolve a node the run never had.
      const graph = await graphForRun(row, deps.definitions);

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

      const status = openNode.agentCrName
        ? await deps.readAgentStatus(openNode.agentCrName)
        : null;
      const recovery = decideNodeRecovery({
        node: openNode,
        timeoutMinutes: node.timeout_minutes,
        status,
        nodeType: node.type,
        nowMs,
      });

      if (recovery.kind === "resolve") {
        // A dropped event lands here instead — it owes the PR the same review and
        // check the event path would have posted, off the same resolved outcome.
        const status = normalizeAgentStatus(recovery.status);
        const result = stationNodeOutcome(node, status);

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
      } else if (recovery.kind === "relaunch") {
        // The gate applies to the recovery door too. Relaunching an agent CR into
        // a dry account is the same wasted pod as dispatching a fresh one, and
        // this arm fires every 60s — it would out-burn the walk itself.
        if (node.type === "agent" && deps.llmGate?.isBlocked()) {
          continue;
        }

        const relaunchInput = {
          node,
          task: taskFromRow(row),
          iteration: openNode.iteration,
          stationRunId: openNode.stationRunId,
          priorOutcome: priorOutcomeOf(nodes, openNode.nodeId),
        };

        await deps.launch(
          nodeLaunchSpec(
            await resolveNodeDispatch(relaunchInput, deps),
            relaunchInput,
          ),
        );
        relaunched++;
      }
    } catch (err) {
      console.error(
        `[assembly-run-reaper] ${row.blueprintName}/${row.id}: ${(err as Error).message}`,
      );
    }
  }

  return `resolved ${resolved}, relaunched ${relaunched}, timed out ${timedOut}, failed-queued ${failedQueued}, re-advanced ${advanced}, swept-single-cr ${sweptSingleCr} across ${open.length} open line(s)`;
}
