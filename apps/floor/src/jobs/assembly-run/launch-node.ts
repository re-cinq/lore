/** Record the visit, then hand a launched node to whoever runs it: a human station, the pooled service, or a cluster-agent-claimable pod. */

import { resolveRequiredTags } from "@re-cinq/lore-shared/project/cluster-agents/required-tags.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { isHumanStation, type NodeVisit } from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { nodeStationFor } from "@re-cinq/lore-stations";
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
  nodeStationFor(nodeType)?.manifest.triggers.some(
    (t) => t.kind === "node" && t.runtime === "service",
  ) === true;

/** One node the walk decided to launch, and everything the launch reads. */
export interface NodeLaunch {
  node: RunGraphNode;
  task: ReturnType<typeof taskFromAssemblyRun>;
  dispatch: Awaited<ReturnType<typeof resolveNodeDispatch>>;
  visits: NodeVisit[];
  assemblyRun: AssemblyRunRecord;
  iteration: number;
  deps: AdvanceDeps;
}

/** Required tags for the cluster-agent claim (FR3) — only a POD-dispatched node's row carries them; the repo-settings read is paid only when it matters. */
async function requiredTagsForPod(
  dispatchedAsPod: boolean,
  node: RunGraphNode,
  repo: string,
  deps: AdvanceDeps,
): Promise<string[] | undefined> {
  if (!dispatchedAsPod) {
    return undefined;
  }

  return resolveRequiredTags(
    node.type,
    node.required_tags,
    await deps.repoSettings(repo),
  );
}

// Row before CR: a crash between them leaves an open row the reaper resolves by reading the deterministically named CR; the row also MINTS the station-run id so a converged duplicate reuses it. A service node names no CR (null), so the reaper never mistakes it for the crash-between-row-and-launch case and relaunches it as a duplicate pod.
async function ensureStationRunFor(
  { node, task, dispatch, assemblyRun, iteration, deps }: NodeLaunch,
  runsInService: boolean,
  dispatchedAsPod: boolean,
): Promise<{ stationRunId: string; nodeRowId: string }> {
  const assemblyLineId = assemblyRun.id;

  return deps.assemblyRuns.ensureStationRun({
    assemblyRunId: assemblyLineId,
    nodeId: node.id,
    iteration,
    agentCrName: runsInService
      ? null
      : nodeAgentName(assemblyLineId, node.id, iteration),
    input: stationRunInputFor(node, task, dispatch.content, dispatch.prompt),
    // Only a POD node's row parks `queued` for a cluster-agent's claim (FR3) — human/service rows keep `running` and are never claimable.
    status: dispatchedAsPod ? "queued" : undefined,
    requiredTags: await requiredTagsForPod(
      dispatchedAsPod,
      node,
      assemblyRun.repo,
      deps,
    ),
  });
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

/** Record the visit, then hand the node to whoever runs it: a human station parks and waits, a service node is published for the pooled service, and everything else arms its row for a cluster-agent to claim. */
export async function launchNode(launch: NodeLaunch): Promise<void> {
  const { node } = launch;
  const runsInService = isServiceNode(node.type);
  const dispatchedAsPod = !isHumanStation(node.type) && !runsInService;
  const { stationRunId, nodeRowId } = await ensureStationRunFor(
    launch,
    runsInService,
    dispatchedAsPod,
  );

  // A human station's worker is outside the pod system (wizard/PR page); the row parks the walk, nothing dispatches, and the outcome arrives later as a resume.
  if (isHumanStation(node.type)) {
    return;
  }

  if (runsInService) {
    await publishServiceNodeEvent(launch, stationRunId);

    return;
  }

  await dispatchStationRun(launch, { stationRunId, nodeRowId });
}
