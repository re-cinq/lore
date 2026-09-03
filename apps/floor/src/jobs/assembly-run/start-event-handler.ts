// Handler for `assembly_line.start` (layer 3): the sole executor entry for assembly
// lines. `project.assemblyRuns.start()` inserted the row (queued) + this event
// atomically; the loop claims it here. The handler validates, marks the row
// running, and launches the ENTRY node's Agent CR — the walk then advances on
// `kubernetes.agent_node.*` events (spec 6-dark-factory FR6.7/FR6.9), with the
// assembly-line reaper as the liveness bound. Detection lines ride the same
// machinery (their detect node is a station CR like any other).

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
  /** Launch the line's entry node (advanceLine). The walk then advances on
   *  `kubernetes.agent_node.*` events — no background promise. */
  advance: (assemblyLineId: string) => Promise<void>;
  /** User-facing failure notification for the config-error close below — the only
   *  line closure that bypasses finishLine's seam. Optional, mirrors AdvanceDeps. */
  notifyFailure?: (
    row: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /** Reopen the settled task behind a FORK (reopenTaskForFork) — settle-task's
   *  start-side twin. Optional seam like notifyFailure; never throws. */
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
    // Branch/args/description ride in the row itself — the walk reads them via
    // taskFromAssemblyRun, so the event only needs identity + routing fields. (The
    // pre-rename `definitionName` fallback was deleted 2026-08-18, #1272, one
    // retention window after the writer flip.)
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

    // A task-backed row without a builtin definition is a single-CR run record
    // (onboard / review / runbook — total coverage): mark it running and return;
    // the agent-watcher finishes it when the task's one CR goes terminal.
    //
    // Caveat: a task-backed start with a typo'd/unknown blueprintName is
    // indistinguishable from a legit single-CR here and becomes a silently
    // forever-running row (no CR was launched for it). Only reachable outside
    // AgentCrStationBackend (manual insert / future producer bug) — log it so
    // the silent failure leaves a breadcrumb.
    if (taskId) {
      console.warn(
        `[assembly-line-start] task-backed row ${assemblyLineId} has no builtin definition "${blueprintName}" — treating as single-CR (verify a CR was launched for task ${taskId})`,
      );
      await deps.assemblyRuns.markRunning(assemblyLineId);

      return;
    }

    // Task-less + unknown definition is a config error, not a transient failure —
    // close the row and resolve so the loop never retries a line that can't exist.
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

/** The definition arm: record WHICH blueprint this run executes, once (FR6.38,
 *  and specs/fork-rerun-from-node FR4). This is the only place holding both the
 *  row id and a RESOLVED blueprint — `start` is called by lore-api and by
 *  choreographies that deliberately ship no definitions — so it is where the
 *  hash AND the graph the run will walk get recorded. Everything downstream
 *  reads the clone instead of re-reading the file. It then launches the entry
 *  node — the walk advances on `kubernetes.agent_node.*` events; a Floor
 *  restart loses nothing because the state is the node rows. A throw propagates
 *  so the event loop retries transient launch failures (advance is idempotent
 *  end to end). */
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

  // A FORK resumes work whose task the source's terminal walk already
  // settled — reopen it before the walk launches, so the task-keyed
  // surfaces (the implementation-loop page's current ticket) see the
  // resumption instead of the source's verdict. Plain starts carry a null
  // `resumedFrom` and skip this.
  if (resumedFrom != null && taskId && deps.reopenTask) {
    await deps.reopenTask({ id: assemblyLineId, taskId });
  }

  await deps.advance(assemblyLineId);
}

/** Composed production handler for the registry. Deps are resolved lazily so
 *  importing the registry never forces the DB pool or the K8s client. */
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

  // Publish the in_progress PR check as soon as the line starts, so a required
  // `lore/code-review` check blocks merge for the whole review window (not just
  // from the first node-terminal). Best-effort — never fails the start.
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
    // Node rows only decide TERMINAL conclusions, so skip the query on the
    // normal (queued/running) start path — but a redelivered start event can
    // land after the line finished, and publishing with empty nodes there would
    // overwrite a correct `neutral` (changes_requested) check with `success`.
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
