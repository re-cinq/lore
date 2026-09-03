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

export function createStartEventHandler(
  deps: StartEventHandlerDeps,
): EventHandler {
  return async (params) => {
    const assemblyLineId = params.assemblyRunId ?? params.assemblyLineId;

    enforceTrue(
      typeof assemblyLineId === "string" && assemblyLineId.length > 0,
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

    // Task-backed row without builtin definition = single-CR record; typos become silent failures (log for breadcrumb).
    if (taskId) {
      console.warn(
        `[assembly-line-start] task-backed row ${assemblyLineId} has no builtin definition "${blueprintName}" — treating as single-CR (verify a CR was launched for task ${taskId})`,
      );
      await deps.assemblyRuns.markRunning(assemblyLineId);

      return;
    }

    // Unknown definition without task = config error (not transient); close row.
    const reason = `no assembly line defined for task type "${blueprintName}"`;
    const row = await deps.assemblyRuns.getById(assemblyLineId);
    const closedNow = await deps.assemblyRuns.finish(
      assemblyLineId,
      "error",
      reason,
    );

    // Winner-only, like finishLine — a redelivered event must not re-notify.
    if (closedNow && row && deps.notifyFailure) {
      try {
        await deps.notifyFailure(row, "error", reason);
      } catch (err) {
        console.error(
          "[notify-failure] notifier threw:",
          (err as Error).message,
        );
      }
    }

    return;
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

async function publishStartCheck(assemblyLineId: string): Promise<void> {
  if (!assemblyLineId) {
    return;
  }

  try {
    const [{ pipeline }, { projectFor }, { publishPrCheck }] =
      await Promise.all([
        import("../../kernel/queues.js"),
        import("../../composition/project-boot.js"),
        import("./pr-check.js"),
      ]);
    const row = await pipeline().assemblyRuns.getById(assemblyLineId);

    if (!row || !(Number(row.args.pr_number) > 0)) {
      return;
    }
    // Skip node query on normal starts; include after finish to avoid overwriting correct checks.
    const nodes =
      row.status === "queued" || row.status === "running"
        ? []
        : await pipeline().assemblyRuns.listStationRuns(assemblyLineId);
    const project = await projectFor(row.repo);

    await publishPrCheck(project.repo, row, nodes, process.env.LORE_UI_URL);
  } catch (err) {
    console.warn("[pr-check] start publish failed:", (err as Error).message);
  }
}
