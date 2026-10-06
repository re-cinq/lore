// A person runs one node of a floor run again (ADR-049): the start event the node declares, with no iteration, which the floor reads as a start by hand; it reopens a finished run to take it.
import type { FloorClient, FloorEventView } from "@re-cinq/floor-client";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { FloorLineBody } from "./floor-run-mapping.js";

/** The parts of a line a start by hand reads. */
export type HandStartLine = Pick<FloorLineBody, "exit" | "fail" | "nodes">;

export interface NodeAsk {
  event: string;
  runId: string;
  actor: string;
}

export interface RunNodeAsk {
  runId: string;
  nodeId: string;
  actor: string;
}

export interface NodeRunAsked {
  runId: string;
  /** True when the floor had not taken the event within the wait: it may still start the node. */
  pending: boolean;
}

export type HandStartFloor = {
  runs: Pick<FloorClient["runs"], "get">;
  lines: Pick<FloorClient["lines"], "version">;
  events: Pick<FloorClient["events"], "post" | "get">;
};

/** How long the answer waits on the floor taking the event, and how it sleeps between reads. */
export interface FloorPatience {
  pollMs: number;
  budgetMs: number;
  sleep(ms: number): Promise<void>;
}

const FLOOR_PATIENCE: FloorPatience = {
  pollMs: 250,
  budgetMs: 5_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The event that starts the node: the one it declares, or the floor's default. Exit and fail end the run, so they have no station to run. */
export function startEventFor(line: HandStartLine, nodeId: string): string {
  const node = line.nodes.find((candidate) => candidate.id === nodeId);

  enforceTrue(node, apiError(400), `the line has no node ${nodeId}`);
  enforceTrue(
    nodeId !== line.exit && nodeId !== line.fail,
    apiError(400),
    `${nodeId} ends the run; there is no station to run`,
  );

  return node.start ?? `node.${nodeId}.start`;
}

/** Posts a node's start by hand: no iteration, so the floor opens the node's next one in the run. */
export function askNode(
  floor: { events: Pick<FloorClient["events"], "post"> },
  { event, runId, actor }: NodeAsk,
): Promise<FloorEventView> {
  return floor.events.post({
    name: event,
    payload: { runId, requestedBy: actor },
  });
}

/** Runs the node again in the run it belongs to, and waits briefly for the floor's answer: taken, refused (409 with the floor's reason), or not yet. */
export async function runNodeByHand(
  floor: HandStartFloor,
  { runId, nodeId, actor }: RunNodeAsk,
  patience: FloorPatience = FLOOR_PATIENCE,
): Promise<NodeRunAsked> {
  const line = await lineOfRun(floor, runId);
  const posted = await askNode(floor, {
    event: startEventFor(line, nodeId),
    runId,
    actor,
  });

  return { runId, pending: await awaitTaken(floor, posted, patience) };
}

/** The line version the run walks; a run the floor does not have is a 404. */
async function lineOfRun(
  floor: HandStartFloor,
  runId: string,
): Promise<HandStartLine> {
  const found = await floor.runs.get(runId);

  enforceTrue(found, apiError(404), `the floor has no run ${runId}`);
  const { lineId, lineHash } = found.run;
  const line = await floor.lines.version(lineId, lineHash);

  enforceTrue(
    line,
    apiError(404),
    `the floor has no line ${lineId}@${lineHash}`,
  );

  return line.body;
}

/** False once the floor acked the event; true when the budget ran out first. A dead-lettered event is the floor's refusal. */
async function awaitTaken(
  floor: Pick<HandStartFloor, "events">,
  posted: FloorEventView,
  { pollMs, budgetMs, sleep }: FloorPatience,
): Promise<boolean> {
  for (let waited = 0; waited < budgetMs; waited += pollMs) {
    await sleep(pollMs);
    const event = await floor.events.get(posted.id);

    if (isTaken(event)) {
      return false;
    }
  }

  return true;
}

function isTaken(event: FloorEventView | null): boolean {
  enforceTrue(
    !event?.deadAt,
    apiError(409),
    event?.lastError ?? "the floor refused the start",
  );

  return Boolean(event?.ackedAt);
}
