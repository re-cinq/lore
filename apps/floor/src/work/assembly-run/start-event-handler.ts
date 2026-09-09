// Handler for assembly_line.start event: sole executor entry; validates and launches entry node (spec 6-dark-factory FR6.7/FR6.9).

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  AssemblyRunsPort,
  AssemblyRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  definitionHash,
  snapshotGraph,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import type { EventHandler } from "../../domain/event-types.js";

export interface StartEventHandlerDeps {
  assemblyRuns: AssemblyRunsPort;
  /** The loaded builtin assembly line YAMLs — routing reads definition presence. */
  definitions: () => Promise<ReadonlyMap<string, AssemblyLine>>;
  /** Launch entry node; walk advances on kubernetes.agent_node.* events (no background promise). */
  advance: (assemblyLineId: string) => Promise<void>;
  /** User-facing failure notification for config-error close; only closure bypassing finishLine's seam. */
  notifyFailure?: (
    row: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /** Reopen settled task for FORK; optional seam like notifyFailure; never throws. */
  reopenTask?: (row: { id: string; taskId: string | null }) => Promise<void>;
}

/** Identity + routing, all a start event carries; branch/args/description live in the row. */
interface StartEvent {
  assemblyLineId: string;
  blueprintName: string;
  taskId: string | null;
  resumedFrom: unknown;
}

export function createStartEventHandler(
  deps: StartEventHandlerDeps,
): EventHandler {
  return async (params) => {
    // Branch/args/description live in the ROW; the event carries only identity + routing (the old definitionName fallback was deleted 2026-08-18, #1272).
    const event = readStartEvent(params);

    await routeStart({ ...event, resumedFrom: params.resumedFrom }, deps);
  };
}

/** The three fields a start event carries. A missing run id throws rather than routing: without it there is no row to fail, so a silently-dropped event would leave a queued run nobody ever walks. */
function readStartEvent(
  params: Record<string, unknown>,
): Omit<StartEvent, "resumedFrom"> {
  const assemblyLineId = params.assemblyRunId ?? params.assemblyLineId;

  enforceTrue(
    isValidAssemblyLineId(assemblyLineId),
    Error,
    "assembly_run.start event params missing assemblyRunId",
  );

  return {
    assemblyLineId,
    blueprintName: String(params.blueprintName ?? ""),
    taskId: typeof params.taskId === "string" ? params.taskId : null,
  };
}

function isValidAssemblyLineId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

/** The three ways a start event routes: a known blueprint walks its graph, a task type without one runs as a single Agent CR, and neither leaves nothing to run — that last case closes the row rather than retrying, since no retry produces a definition that does not exist. */
async function routeStart(
  event: StartEvent,
  deps: StartEventHandlerDeps,
): Promise<void> {
  const { assemblyLineId, blueprintName, taskId } = event;
  const definitions = await deps.definitions();
  const definition = definitions.get(blueprintName);

  if (definition) {
    return startResolvedBlueprint({ ...event, taskId, definition }, deps);
  }

  if (taskId) {
    return markSingleCrRun(assemblyLineId, blueprintName, taskId, deps);
  }

  return closeUnknownDefinitionRun(
    assemblyLineId,
    `no assembly line defined for task type "${blueprintName}"`,
    deps,
  );
}

/** Task-backed row without builtin definition = single-CR record; typos become silent failures (log for breadcrumb). */
async function markSingleCrRun(
  assemblyLineId: string,
  blueprintName: string,
  taskId: string,
  deps: StartEventHandlerDeps,
): Promise<void> {
  console.warn(
    `[assembly-line-start] task-backed row ${assemblyLineId} has no builtin definition "${blueprintName}" — treating as single-CR (verify a CR was launched for task ${taskId})`,
  );
  await deps.assemblyRuns.markRunning(assemblyLineId);
}

/** Unknown definition without task = config error (not transient); close row and notify the winning closer only — a redelivered event must not re-notify. */
async function closeUnknownDefinitionRun(
  assemblyLineId: string,
  reason: string,
  deps: StartEventHandlerDeps,
): Promise<void> {
  const row = await deps.assemblyRuns.getById(assemblyLineId);
  const closedNow = await deps.assemblyRuns.finish(
    assemblyLineId,
    "error",
    reason,
  );

  if (!closedNow || !row || !deps.notifyFailure) {
    return;
  }

  try {
    await deps.notifyFailure(row, "error", reason);
  } catch (err) {
    console.error("[notify-failure] notifier threw:", (err as Error).message);
  }
}

/** Record resolved blueprint hash and snapshot graph; walk state persists in node rows (FR6.38, specs/fork-rerun-from-node FR4). */
async function startResolvedBlueprint(
  params: StartEvent & { definition: AssemblyLine },
  deps: StartEventHandlerDeps,
): Promise<void> {
  const { assemblyLineId, blueprintName, taskId, resumedFrom, definition } =
    params;

  await deps.assemblyRuns.stampBlueprint(
    assemblyLineId,
    definitionHash(definition),
    snapshotGraph(definition, blueprintName),
  );
  await deps.assemblyRuns.markRunning(assemblyLineId);

  // FORK: reopen task before walk so task-keyed surfaces show resumption not verdict.
  if (resumedFrom != null && taskId && deps.reopenTask) {
    await deps.reopenTask({ id: assemblyLineId, taskId });
  }

  await deps.advance(assemblyLineId);
}

/** Composed production handler. */
export const assemblyLineStart: EventHandler = async (params) => {
  const handler = await productionStartHandler();

  await handler(params);

  // Publish check immediately so lore/code-review blocks merge for the whole window (best-effort).
  await publishStartCheck(
    String(params.assemblyRunId ?? params.assemblyLineId ?? ""),
  );
};

/** Every seam the handler needs, resolved lazily so importing this module forces no DB pool or K8s client. */
async function productionStartHandler(): Promise<EventHandler> {
  const [queues, lines, nodeEvents, notify, reopen] = await Promise.all([
    import("../../outbound/queues.js"),
    import("@re-cinq/lore-assembly-lines"),
    import("./node-event-handler.js"),
    import("./notify-failure.js"),
    import("./reopen-task.js"),
  ]);

  return createStartEventHandler({
    assemblyRuns: queues.pipeline().assemblyRuns,
    definitions: lines.loadBuiltinAssemblyLines,
    advance: advanceSeam(nodeEvents),
    notifyFailure: notify.notifyLineFailure,
    reopenTask: (row) =>
      reopen.reopenTaskForFork(row, { tasks: queues.taskStore() }),
  });
}

/** Launches the walk for one run, building the node-event deps at call time rather than at handler-composition time. */
function advanceSeam(
  nodeEvents: typeof import("./node-event-handler.js"),
): StartEventHandlerDeps["advance"] {
  return async (assemblyLineId) =>
    nodeEvents.advanceLine(
      assemblyLineId,
      await nodeEvents.productionNodeEventDeps(),
    );
}

async function publishStartCheck(assemblyLineId: string): Promise<void> {
  if (!assemblyLineId) {
    return;
  }

  try {
    await publishCheckForRun(assemblyLineId);
  } catch (err) {
    console.warn("[pr-check] start publish failed:", (err as Error).message);
  }
}

/** Reads the run and, once finished, its node rows, then stamps the PR check. */
async function publishCheckForRun(assemblyLineId: string): Promise<void> {
  const [{ pipeline }, { projectFor }, { publishPrCheck }] = await Promise.all([
    import("../../outbound/queues.js"),
    import("../../outbound/project-boot.js"),
    import("./pr-check.js"),
  ]);
  const row = await pipeline().assemblyRuns.getById(assemblyLineId);

  if (!hasPrNumber(row)) {
    return;
  }
  const nodes = await nodesForStartCheck(row, assemblyLineId, (id) =>
    pipeline().assemblyRuns.listStationRuns(id),
  );
  const project = await projectFor(row.repo);

  await publishPrCheck(project.repo, row, nodes, process.env.LORE_UI_URL);
}

function hasPrNumber(row: AssemblyRunRecord | null): row is AssemblyRunRecord {
  return row !== null && Number(row.args.pr_number) > 0;
}

/** Skip the node query on normal starts; include it after finish to avoid overwriting correct checks. */
async function nodesForStartCheck(
  row: AssemblyRunRecord,
  assemblyLineId: string,
  listStationRuns: (
    id: string,
  ) => ReturnType<AssemblyRunsPort["listStationRuns"]>,
): Promise<Awaited<ReturnType<AssemblyRunsPort["listStationRuns"]>>> {
  if (row.status === "queued" || row.status === "running") {
    return [];
  }

  return listStationRuns(assemblyLineId);
}
