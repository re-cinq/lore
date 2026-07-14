// Handler for `assembly_line.start` (layer 3): the sole executor entry for assembly
// lines. `project.assemblyLines.start()` inserted the row (queued) + this event
// atomically; the loop claims it here. The run itself is minutes-to-hours, so the
// handler validates, marks the row running, fire-and-backgrounds the walk, and
// resolves immediately — terminal row status is written by the background
// continuation. The branch lease + the agent-watcher remain the liveness signal,
// exactly as the pre-event inline paths.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import type {
  AssemblyLine,
  SupervisorResult,
} from "@re-cinq/lore-assembly-lines";
import type { EventHandler } from "../../main-loop/types.js";
import { supervisorOutcome } from "./floor-assembly-line-run.js";

/** The repo-less detection run input — jobs/detect path. */
export interface DetectRunInput {
  assemblyLineId: string;
  definitionName: string;
  repo: string;
}

export interface StartEventHandlerDeps {
  assemblyLines: AssemblyLinesPort;
  /** The loaded builtin assembly line YAMLs — routing reads definition shape. */
  definitions: () => Promise<ReadonlyMap<string, AssemblyLine>>;
  /** Definitions with a `detect` node: the repo-less detection runner. */
  runDetect: (input: DetectRunInput) => Promise<SupervisorResult>;
  /** Every other definition: launch the line's entry node (advanceLine). The walk
   *  then advances on `kubernetes.agent_node.*` events — no background promise. */
  advance: (assemblyLineId: string) => Promise<void>;
}

export function createStartEventHandler(
  deps: StartEventHandlerDeps,
): EventHandler {
  return async (params) => {
    const assemblyLineId = params.assemblyLineId;

    enforceTrue(
      typeof assemblyLineId === "string" && assemblyLineId.length > 0,
      Error,
      "assembly_line.start event params missing assemblyLineId",
    );
    // Branch/args/description ride in the row itself — the walk reads them via
    // taskFromRow, so the event only needs identity + routing fields.
    const definitionName = String(params.definitionName ?? "");
    const repo = String(params.repo ?? "");
    const taskId = typeof params.taskId === "string" ? params.taskId : null;

    const definitions = await deps.definitions();
    const definition = definitions.get(definitionName);

    if (!definition) {
      // A task-backed row without a builtin definition is a single-CR run record
      // (onboard / review / runbook — total coverage): mark it running and return;
      // the agent-watcher finishes it when the task's one CR goes terminal.
      //
      // Caveat: a task-backed start with a typo'd/unknown definitionName is
      // indistinguishable from a legit single-CR here and becomes a silently
      // forever-running row (no CR was launched for it). Only reachable outside
      // AgentCrStationBackend (manual insert / future producer bug) — log it so
      // the silent failure leaves a breadcrumb.
      if (taskId) {
        console.warn(
          `[assembly-line-start] task-backed row ${assemblyLineId} has no builtin definition "${definitionName}" — treating as single-CR (verify a CR was launched for task ${taskId})`,
        );
        await deps.assemblyLines.markRunning(assemblyLineId);

        return;
      }

      // Task-less + unknown definition is a config error, not a transient failure —
      // close the row and resolve so the loop never retries a line that can't exist.
      await deps.assemblyLines.finish(
        assemblyLineId,
        "error",
        `no assembly line defined for task type "${definitionName}"`,
      );

      return;
    }

    await deps.assemblyLines.markRunning(assemblyLineId);

    const finishRow = (outcome: string, reason?: string) =>
      deps.assemblyLines
        .finish(assemblyLineId, outcome, reason)
        .catch((err) =>
          console.warn(
            `[assembly-line-start] finish(${assemblyLineId}) failed:`,
            (err as Error).message,
          ),
        );

    // Routing is by definition shape, not a name list: any definition carrying a
    // detect node is a repo-less detection line — no task, no clone, no PR.
    if (definition.nodes.some((n) => n.type === "detect")) {
      void deps
        .runDetect({ assemblyLineId, definitionName, repo })
        .then((result) =>
          finishRow(supervisorOutcome(result), result.errorMessage),
        )
        .catch((err) => finishRow("error", (err as Error).message));

      return;
    }

    // Station lines: launch the entry node and return — the walk advances on
    // `kubernetes.agent_node.*` events; a Floor restart loses nothing because
    // the state is the node rows. A throw here propagates so the event loop
    // retries transient launch failures (advance is idempotent end to end).
    await deps.advance(assemblyLineId);
  };
}

/** Composed production handler for the registry. Deps are resolved lazily so
 *  importing the registry never forces the DB pool or the K8s client. */
export const assemblyLineStart: EventHandler = async (params) => {
  const [
    { assemblyLines },
    { loadBuiltinAssemblyLines },
    { runDetect },
    { advanceLine, productionNodeEventDeps },
  ] = await Promise.all([
    import("../../kernel/queues.js"),
    import("@re-cinq/lore-assembly-lines"),
    import("../detect/run-detect.js"),
    import("./node-event-handler.js"),
  ]);

  const handler = createStartEventHandler({
    assemblyLines: assemblyLines(),
    definitions: loadBuiltinAssemblyLines,
    runDetect,
    advance: async (assemblyLineId) =>
      advanceLine(assemblyLineId, await productionNodeEventDeps()),
  });

  return handler(params);
};
