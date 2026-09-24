// Run any station of a line, at any time (specs/fork-rerun-from-node FR8): the node's next iteration, in the SAME run. lore-api checks the ask and reopens an ended run, so the page goes live at once; the Floor launches the node on the event, since only the Floor resolves a dispatch.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { EventReporter } from "@re-cinq/lore-shared/project/events/event-reporter-port.js";
import { RUN_STATION_EVENT } from "@re-cinq/lore-shared/project/assembly-runs/run-events.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

export interface RunStationDeps {
  runs: Pick<
    AssemblyRunsPort,
    "getById" | "listStationRuns" | "findOpenBySubject" | "reopen"
  >;
  reporter: EventReporter;
  graphOf: (line: AssemblyRunRecord) => Promise<RunGraph | null | undefined>;
  /** The graph's stations a person works; the engine's classification, injected because this layer may not import the engine. */
  humanStationIds: (graph: RunGraph) => Set<string>;
}

export interface RunStationInput {
  runId: string;
  nodeId: string;
  /** Who asked; recorded on the visit the Floor launches. */
  actor: string;
}

const OPEN = new Set(["queued", "running"]);

/** The run's id once the station is asked for. 404 for a run that does not exist, 400 for a node its graph does not have, 409 while a station of it is still working or when another run took its subject since it ended. */
export async function runStation(
  deps: RunStationDeps,
  { runId, nodeId, actor }: RunStationInput,
): Promise<string> {
  const line = await deps.runs.getById(runId);

  enforceTrue(line !== null, apiError(404), "assembly run not found");
  const graph = await deps.graphOf(line);

  assertNodeOf(line, graph, nodeId);
  await assertNoStationWorking(deps, line, graph);
  await reopenIfEnded(deps, line);
  await deps.reporter.insert({
    eventName: RUN_STATION_EVENT,
    source: "internal",
    params: { assemblyRunId: line.id, nodeId, actor, repo: line.repo },
  });

  return line.id;
}

function assertNodeOf(
  line: AssemblyRunRecord,
  graph: RunGraph | null | undefined,
  nodeId: string,
): asserts graph is RunGraph {
  enforceTrue(
    graph?.nodes.some((node) => node.id === nodeId),
    apiError(400),
    `"${nodeId}" is not a station of ${line.blueprintName}`,
  );
}

// A wait on a person is what "run a station" moves past; a machine station in flight is not — two pods would work one branch at once.
async function assertNoStationWorking(
  deps: RunStationDeps,
  line: AssemblyRunRecord,
  graph: RunGraph,
): Promise<void> {
  const human = deps.humanStationIds(graph);
  const working = (await deps.runs.listStationRuns(line.id)).find(
    (visit) => visit.outcome === null && !human.has(visit.nodeId),
  );

  enforceTrue(
    !working,
    apiError(409),
    `the ${working?.nodeId} station is still working; wait for it to finish`,
  );
}

// Reopening takes the subject back, so a run that took it over since must finish first — one open line per subject is the engine's invariant.
async function reopenIfEnded(
  deps: RunStationDeps,
  line: AssemblyRunRecord,
): Promise<void> {
  if (OPEN.has(line.status)) {
    return;
  }
  const holder = line.subjectKey
    ? await deps.runs.findOpenBySubject(line.repo, line.subjectKey)
    : null;

  enforceTrue(
    holder === null,
    apiError(409),
    `another run (${holder?.id}) is already working ${line.subjectKey}; wait for it or cancel it first`,
  );
  await deps.runs.reopen(line.id);
}
