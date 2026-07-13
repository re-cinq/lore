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
import type { FloorAssemblyLineTask } from "./floor-assembly-line.js";
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
  /** Every other definition: the Floor AssemblyLine, one Agent CR per node. */
  runOnStation: (task: FloorAssemblyLineTask) => Promise<SupervisorResult>;
  /** Reclaim the run's per-task token triple once the station line is fully done — the
   *  only safe point, since the line's node CRs share one `pt-<id>` token. */
  cleanupToken: (taskId: string) => Promise<void>;
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
    const definitionName = String(params.definitionName ?? "");
    const repo = String(params.repo ?? "");
    const branch = typeof params.branch === "string" ? params.branch : null;
    const taskId = typeof params.taskId === "string" ? params.taskId : null;
    const args = (params.args ?? {}) as Record<string, unknown>;
    const description =
      typeof args.description === "string" ? args.description : "";

    const definitions = await deps.definitions();
    const definition = definitions.get(definitionName);

    if (!definition) {
      // Config error, not a transient failure — close the row and resolve so the
      // loop never retries an assembly line that can't exist.
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

    // A task-less line (e.g. code-review) has no pipeline task; fall back to the
    // per-attempt assemblyLineId so the per-task token + `task-id` label are unique
    // per run. An empty taskId would key the token on "" → a single shared `pt-`
    // triple that concurrent runs across repos race on (wrong-repo clone). The
    // watcher's `processAgentCr` no-ops on a taskId with no backing task.
    const runTaskId = taskId ?? assemblyLineId;

    void deps
      .runOnStation({
        assemblyLineId,
        taskId: runTaskId,
        taskType: definitionName,
        description,
        targetRepo: repo,
        branch: branch ?? "",
      })
      .then((result) =>
        finishRow(supervisorOutcome(result), result.errorMessage),
      )
      .catch((err) => finishRow("error", (err as Error).message))
      // The line is fully done here (all node CRs terminal) → reclaim its shared token.
      .finally(() => {
        void deps.cleanupToken(runTaskId);
      });
  };
}

/** Composed production handler for the registry. Deps are resolved lazily so
 *  importing the registry never forces the DB pool or the K8s client. */
export const assemblyLineStart: EventHandler = async (params) => {
  const [
    { assemblyLines },
    { loadBuiltinAssemblyLines },
    { runFloorAssemblyLineForTask, floorAssemblyLineRuntime },
    { agentCrBackend },
    { runDetect },
    { cleanupPerTaskToken },
  ] = await Promise.all([
    import("../../kernel/queues.js"),
    import("@re-cinq/lore-assembly-lines"),
    import("./floor-assembly-line-run.js"),
    import("../../composition/project-boot.js"),
    import("../detect/run-detect.js"),
    import("../watcher/agent-watcher.js"),
  ]);

  const handler = createStartEventHandler({
    assemblyLines: assemblyLines(),
    definitions: loadBuiltinAssemblyLines,
    runDetect,
    runOnStation: (task) =>
      runFloorAssemblyLineForTask(
        task,
        floorAssemblyLineRuntime(agentCrBackend()),
      ),
    cleanupToken: cleanupPerTaskToken,
  });

  return handler(params);
};
