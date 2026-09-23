// Run any station of a line, at any time (specs/fork-rerun-from-node FR8): a fresh line on the same work, entered at the chosen node. An open source line is retired first — one open line per subject is the engine's invariant, and the person clicking asked for THIS node to run, not for the parked one to keep waiting.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
  AssemblyRunStartInput,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

export type RunStationPort = Pick<
  AssemblyRunsPort,
  "getById" | "finish" | "findOpenBySubject" | "start"
>;

export interface RunStationInput {
  runId: string;
  nodeId: string;
  /** Who asked; recorded on the retired line's reason and the new line's args. */
  actor: string;
}

const OPEN = new Set(["queued", "running"]);

/** The id of the fresh line. 404 for a run that does not exist, 400 for a node its graph does not have, 409 when another line already works the subject. */
export async function runStation(
  port: RunStationPort,
  graphOf: (line: AssemblyRunRecord) => Promise<RunGraph | null | undefined>,
  { runId, nodeId, actor }: RunStationInput,
): Promise<string> {
  const line = await port.getById(runId);

  enforceTrue(line !== null, apiError(404), "assembly run not found");
  await assertNodeOf(line, nodeId, graphOf);
  await retireIfOpen(port, line, nodeId, actor);
  await assertSubjectFree(port, line);

  return port.start(freshLine(line, nodeId, actor));
}

async function assertNodeOf(
  line: AssemblyRunRecord,
  nodeId: string,
  graphOf: (line: AssemblyRunRecord) => Promise<RunGraph | null | undefined>,
): Promise<void> {
  const graph = await graphOf(line);

  enforceTrue(
    graph?.nodes.some((node) => node.id === nodeId),
    apiError(400),
    `"${nodeId}" is not a station of ${line.blueprintName}`,
  );
}

// The retired line's reason names the hand that did it, so its page never reads as a machine failure.
async function retireIfOpen(
  port: RunStationPort,
  line: AssemblyRunRecord,
  nodeId: string,
  actor: string,
): Promise<void> {
  if (OPEN.has(line.status)) {
    await port.finish(
      line.id,
      "cancelled",
      `${actor} ran the ${nodeId} station by hand; a fresh line took over this work`,
    );
  }
}

// The source is retired, so the only holder left would be some OTHER line — joining it silently is what start() would do, and that is never what a person who named a station meant.
async function assertSubjectFree(
  port: RunStationPort,
  line: AssemblyRunRecord,
): Promise<void> {
  if (!line.subjectKey) {
    return;
  }
  const holder = await port.findOpenBySubject(line.repo, line.subjectKey);

  enforceTrue(
    holder === null,
    apiError(409),
    `another run (${holder?.id}) is already working ${line.subjectKey}; wait for it or cancel it first`,
  );
}

/** The same work — repo, branch, task, subject, args — on a fresh line whose clone enters at the chosen node (`entry_node`, 6-dark-factory FR6.38). */
function freshLine(
  line: AssemblyRunRecord,
  nodeId: string,
  actor: string,
): AssemblyRunStartInput {
  return {
    blueprintName: line.blueprintName,
    repo: line.repo,
    ...(line.branch ? { branch: line.branch } : {}),
    ...(line.taskId ? { taskId: line.taskId } : {}),
    ...(line.subjectKey ? { subjectKey: line.subjectKey } : {}),
    args: {
      ...line.args,
      entry_node: nodeId,
      run_station_by: actor,
      run_station_from: line.id,
    },
  };
}
