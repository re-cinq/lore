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

import {
  stationNodeOutcome,
  type AgentNodeStatus,
  type AssemblyLine,
  type AssemblyLineNode,
} from "@re-cinq/lore-assembly-lines";
import type { AssemblyLineNodeRecord } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import { advanceLine, finishNodeAndAdvance, taskFromRow } from "./advance.js";
import { nodeAgentSpec, nodeStationSpec } from "./floor-assembly-line.js";
import type { NodeEventDeps } from "./node-event-handler.js";

const MINUTE_MS = 60_000;
/** Parity with the old poll loop's ~1h default (DEFAULT_MAX_POLLS) . */
const DEFAULT_TIMEOUT_MINUTES = 60;
const TIMEOUT_BUFFER_MINUTES = 2;
const QUEUED_LIMIT_MINUTES = 30;

export type NodeRecovery =
  | { kind: "resolve"; status: AgentNodeStatus }
  | { kind: "relaunch" }
  | { kind: "timeout" }
  | { kind: "wait" };

/** Pure per-open-node decision from the node row's age and the CR's live status. */
export function decideNodeRecovery(input: {
  node: AssemblyLineNodeRecord;
  timeoutMinutes: number | undefined;
  status: AgentNodeStatus | null;
  nowMs: number;
}): NodeRecovery {
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

  if (input.status === null) {
    return { kind: "relaunch" };
  }

  return { kind: "wait" };
}

/** One sweep over every open line; per-line failures are logged and skipped so a
 *  single bad row never wedges the tick. */
export async function assemblyLineReaperJob(
  deps: NodeEventDeps,
): Promise<string> {
  const open = await deps.assemblyLines.listOpen();
  const definitions = await deps.definitions();
  const nowMs = Date.now();
  let resolved = 0;
  let relaunched = 0;
  let timedOut = 0;
  let failedQueued = 0;
  let advanced = 0;

  for (const row of open) {
    try {
      const definition = definitions.get(row.definitionName);

      if (!definition) {
        // Single-CR run record (FR6.8) — the agent-watcher owns its lifecycle.
        continue;
      }

      if (row.status === "queued") {
        if (
          nowMs - row.createdAt.getTime() >
          QUEUED_LIMIT_MINUTES * MINUTE_MS
        ) {
          await deps.assemblyLines.finish(
            row.id,
            "error",
            "assembly_line.start never completed",
          );
          failedQueued++;
        }
        continue;
      }

      const nodes = await deps.assemblyLines.listNodes(row.id);
      const openNode = nodes.find((n) => n.outcome === null);

      if (!openNode) {
        await advanceLine(row.id, deps);
        advanced++;
        continue;
      }

      const node = definition.nodes.find((n) => n.id === openNode.nodeId);

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
        nowMs,
      });

      if (recovery.kind === "resolve") {
        await finishNodeAndAdvance(
          {
            assemblyLineId: row.id,
            nodeId: openNode.nodeId,
            result: stationNodeOutcome(node, recovery.status),
          },
          deps,
        );
        resolved++;
      } else if (recovery.kind === "timeout") {
        await finishNodeAndAdvance(
          {
            assemblyLineId: row.id,
            nodeId: openNode.nodeId,
            result: { outcome: "failed" },
          },
          deps,
        );
        timedOut++;
        console.warn(
          `[assembly-line-reaper] node ${openNode.nodeId} of ${row.id} timed out (${node.type === "agent" ? "agent" : "station"}-timeout)`,
        );
      } else if (recovery.kind === "relaunch") {
        await deps.launch(specForNode(definition, node, row, deps));
        relaunched++;
      }
    } catch (err) {
      console.error(
        `[assembly-line-reaper] ${row.definitionName}/${row.id}: ${(err as Error).message}`,
      );
    }
  }

  return `resolved ${resolved}, relaunched ${relaunched}, timed out ${timedOut}, failed-queued ${failedQueued}, re-advanced ${advanced} across ${open.length} open line(s)`;
}

function specForNode(
  definition: AssemblyLine,
  node: AssemblyLineNode,
  row: Parameters<typeof taskFromRow>[0],
  deps: NodeEventDeps,
) {
  const task = taskFromRow(row);

  return node.type === "agent"
    ? nodeAgentSpec(
        node,
        task,
        deps.resolvePrompt(node.prompt_ref ?? node.type, task.description),
      )
    : nodeStationSpec(node, task);
}
