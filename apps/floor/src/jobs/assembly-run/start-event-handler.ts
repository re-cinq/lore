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
import type { EventHandler } from "../../main-loop/types.js";

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

function isValidAssemblyLineId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
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

export function createStartEventHandler(
  deps: StartEventHandlerDeps,
): EventHandler {
  return async (params) => {
    const assemblyLineId = params.assemblyRunId ?? params.assemblyLineId;

    enforceTrue(
      isValidAssemblyLineId(assemblyLineId),
      Error,
      "assembly_run.start event params missing assemblyRunId",
    );
    // Branch/args/description in row; event only needs identity + routing (old definitionName fallback deleted 2026-08-18 #1272).
    const blueprintName = String(params.blueprintName ?? "");
    const taskId = typeof params.taskId === "string" ? params.taskId : null;

    const definitions = await deps.definitions();
    const definition = definitions.get(blueprintName);

    if (definition) {
      await startResolvedBlueprint(
        {
          assemblyLineId,
          blueprintName,
          taskId,
          resumedFrom: params.resumedFrom,
          definition,
        },
        deps,
      );

      return;
    }

    if (taskId) {
      await markSingleCrRun(assemblyLineId, blueprintName, taskId, deps);

      return;
    }

    await closeUnknownDefinitionRun(
      assemblyLineId,
      `no assembly line defined for task type "${blueprintName}"`,
      deps,
    );
  };
}

/** Record resolved blueprint hash and snapshot graph; walk state persists in node rows (FR6.38, specs/fork-rerun-from-node FR4). */
async function startResolvedBlueprint(
  params: {
    assemblyLineId: string;
    blueprintName: string;
    taskId: string | null;
    resumedFrom: unknown;
    definition: AssemblyLine;
  },
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

/** Composed production handler; deps resolved lazily to avoid forcing DB pool or K8s client. */
export const assemblyLineStart: EventHandler = async (params) => {
  const [
    { pipeline },
    { loadBuiltinAssemblyLines },
    { advanceLine, productionNodeEventDeps },
  ] = await Promise.all([
    import("../../kernel/queues.js"),
    import("@re-cinq/lore-assembly-lines"),
    import("./node-event-handler.js"),
  ]);

  const { notifyLineFailure } = await import("./notify-failure.js");
  const { reopenTaskForFork } = await import("./reopen-task.js");
  const { taskStore } = await import("../../kernel/queues.js");

  const handler = createStartEventHandler({
    assemblyRuns: pipeline().assemblyRuns,
    definitions: loadBuiltinAssemblyLines,
    advance: async (assemblyLineId) =>
      advanceLine(assemblyLineId, await productionNodeEventDeps()),
    notifyFailure: notifyLineFailure,
    reopenTask: (row) => reopenTaskForFork(row, { tasks: taskStore() }),
  });

  await handler(params);

  // Publish check immediately so lore/code-review blocks merge for the whole window (best-effort).
  await publishStartCheck(
    String(params.assemblyRunId ?? params.assemblyLineId ?? ""),
  );
};

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

async function publishStartCheck(assemblyLineId: string): Promise<void> {
  if (!assemblyLineId) {
    return;
  }

  try {
    const [{ pipeline }, { projectFor }, { publishPrCheck }] =
      await Promise.all([
        import("../../kernel/queues.js"),
        import("../../kernel/project-boot.js"),
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
  } catch (err) {
    console.warn("[pr-check] start publish failed:", (err as Error).message);
  }
}
