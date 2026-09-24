/** Record the visit, then hand a launched node to whoever runs it: a human station, the pooled service, or a cluster-agent-claimable pod. */

import {
  AGENT_FILES_TAG,
  resolveRequiredTags,
} from "@re-cinq/lore-shared/project/cluster-agents/required-tags.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { isHumanStation, type NodeVisit } from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { nodeTriggersFor } from "./node-station-triggers.js";
import {
  nodeAgentName,
  stationNodeParams,
  stationRunInputFor,
} from "./floor-assembly-run.js";
import {
  SERVICE_NODE_EVENT,
  serviceNodeDedupeKey,
} from "@re-cinq/lore-shared/project/events/service-node-event.js";
import {
  incomingFailureOf,
  nodeLaunchSpec,
  priorOutcomeOf,
  resolveNodeDispatch,
} from "./launch-spec.js";
import type { AdvanceDeps } from "./advance-deps.js";
import { taskFromAssemblyRun } from "./walk-state.js";

/** True when this node type's station runs in the pooled service, not a pod. */
const isServiceNode = (nodeType: string): boolean =>
  nodeTriggersFor(nodeType).some(
    (t) => t.kind === "node" && t.runtime === "service",
  );

/** One node the walk decided to launch, and everything the launch reads. */
export interface NodeLaunch {
  node: RunGraphNode;
  task: ReturnType<typeof taskFromAssemblyRun>;
  dispatch: Awaited<ReturnType<typeof resolveNodeDispatch>>;
  visits: NodeVisit[];
  assemblyRun: AssemblyRunRecord;
  iteration: number;
  /** The person who ran this station by hand; absent when the walk launched it. */
  requestedBy?: string;
  deps: AdvanceDeps;
}

/** How the node reaches its executor: the pooled service, a pod, or a human station (neither). */
interface NodeDispatchKind {
  runsInService: boolean;
  dispatchedAsPod: boolean;
}

/** Record the visit, then hand the node to whoever runs it: a human station parks and waits, a service node is published for the pooled service, and everything else arms its row for a cluster-agent to claim. */
export async function launchNode(launch: NodeLaunch): Promise<void> {
  const { node } = launch;
  const runsInService = isServiceNode(node.type);
  const dispatchedAsPod = !isHumanStation(node.type) && !runsInService;
  const { stationRunId, nodeRowId } = await ensureStationRunFor(launch, {
    runsInService,
    dispatchedAsPod,
  });

  // A human station's worker is outside the pod system (wizard/PR page); the row parks the walk, nothing dispatches, and the outcome arrives later as a resume.
  if (isHumanStation(node.type)) {
    await announceParked(launch);

    return;
  }

  if (runsInService) {
    await publishServiceNodeEvent(launch, stationRunId);

    return;
  }

  await dispatchStationRun(launch, { stationRunId, nodeRowId });
}

// Best-effort: the parked row already IS the park, so a reaction that fails (lore-api down) must never un-park the walk or fail the run.
async function announceParked({
  assemblyRun,
  node,
  deps,
}: NodeLaunch): Promise<void> {
  try {
    await deps.onHumanNodeParked?.(assemblyRun, node);
  } catch (err) {
    console.warn(
      `[floor] run ${assemblyRun.id} parked on ${node.id}; reacting to it failed: ${errorMessage(err)}`,
    );
  }
}

// Row before CR: a crash between them leaves an open row the reaper resolves by reading the deterministically named CR; the row also MINTS the station-run id so a converged duplicate reuses it. A service node names no CR (null), so the reaper never mistakes it for the crash-between-row-and-launch case and relaunches it as a duplicate pod.
async function ensureStationRunFor(
  launch: NodeLaunch,
  { runsInService, dispatchedAsPod }: NodeDispatchKind,
): Promise<{ stationRunId: string; nodeRowId: string }> {
  const { node, task, dispatch, assemblyRun, iteration, deps } = launch;

  return deps.assemblyRuns.ensureStationRun({
    assemblyRunId: assemblyRun.id,
    nodeId: node.id,
    iteration,
    agentCrName: runsInService
      ? null
      : nodeAgentName(assemblyRun.id, node.id, iteration),
    input: stationRunInputFor(node, task, dispatch.content, dispatch.prompt),
    requestedBy: launch.requestedBy,
    ...(dispatchedAsPod
      ? await podClaimFields(node, assemblyRun.repo, dispatch, deps)
      : {}),
  });
}

/** Claim fields only a POD-dispatched node's row carries (FR3): `queued` parks it for a cluster-agent claim while human/service rows keep `running`, and the repo-settings read behind its required tags is paid only when it matters. */
async function podClaimFields(
  node: RunGraphNode,
  repo: string,
  dispatch: NodeLaunch["dispatch"],
  deps: AdvanceDeps,
): Promise<{ status: "queued"; requiredTags: string[] }> {
  const tags = resolveRequiredTags(
    node.type,
    node.required_tags,
    await deps.repoSettings(repo),
  );

  return {
    status: "queued",
    requiredTags: dispatch.files.length > 0 ? [...tags, AGENT_FILES_TAG] : tags,
  };
}

/** Published, not launched: the row already exists, so the service has something to report against, and the dedupe key is that row — a redelivered event cannot run the node twice. */
async function publishServiceNodeEvent(
  { node, task, assemblyRun, iteration, deps }: NodeLaunch,
  stationRunId: string,
): Promise<void> {
  await deps.publishNode?.({
    eventName: SERVICE_NODE_EVENT,
    dedupeKey: serviceNodeDedupeKey(stationRunId),
    params: {
      stationRunId,
      assemblyLineId: assemblyRun.id,
      nodeId: node.id,
      iteration,
      nodeType: node.type,
      repo: assemblyRun.repo,
      branch: assemblyRun.branch,
      taskId: assemblyRun.taskId ?? null,
      params: stationNodeParams(node, task),
    },
  });
}

/** Arms the queued row with the dispatch spec for a cluster-agent to claim (FR3) instead of pushing to a single one; written AFTER ensureStationRun so only armed rows are claimable. */
async function dispatchStationRun(
  { node, task, dispatch, visits, iteration, deps }: NodeLaunch,
  ids: { stationRunId: string; nodeRowId: string },
): Promise<void> {
  const spec = nodeLaunchSpec(dispatch, {
    node,
    task,
    iteration,
    stationRunId: ids.stationRunId,
    priorOutcome: priorOutcomeOf(visits, node.id),
    incomingFailure: incomingFailureOf(visits),
  });

  // Points the CR at the catalog spelling this repo actually gets (qualified vs bare org default), resolved at enqueue time so the claiming cluster needs no catalog knowledge.
  if (deps.qualifyStationRef) {
    spec.stationRef = await deps.qualifyStationRef(
      spec.stationRef ?? task.taskType,
      task.targetRepo,
    );
  }

  await deps.assemblyRuns.enqueueStationRunDispatch(ids.nodeRowId, spec);
}
