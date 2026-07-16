// Handler for `assembly_line.start` (layer 3): the sole executor entry for assembly
// lines. `project.assemblyLines.start()` inserted the row (queued) + this event
// atomically; the loop claims it here. The handler validates, marks the row
// running, and launches the ENTRY node's Agent CR — the walk then advances on
// `kubernetes.agent_node.*` events (spec 6-dark-factory FR6.7/FR6.9), with the
// assembly-line reaper as the liveness bound. Detection lines ride the same
// machinery (their detect node is a station CR like any other).

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import type { AssemblyLine } from "@re-cinq/lore-assembly-lines";
import type { EventHandler } from "../../main-loop/types.js";

export interface StartEventHandlerDeps {
  assemblyLines: AssemblyLinesPort;
  /** The loaded builtin assembly line YAMLs — routing reads definition presence. */
  definitions: () => Promise<ReadonlyMap<string, AssemblyLine>>;
  /** Launch the line's entry node (advanceLine). The walk then advances on
   *  `kubernetes.agent_node.*` events — no background promise. */
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

    // Launch the entry node and return — the walk advances on
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
    { advanceLine, productionNodeEventDeps },
  ] = await Promise.all([
    import("../../kernel/queues.js"),
    import("@re-cinq/lore-assembly-lines"),
    import("./node-event-handler.js"),
  ]);

  const handler = createStartEventHandler({
    assemblyLines: assemblyLines(),
    definitions: loadBuiltinAssemblyLines,
    advance: async (assemblyLineId) =>
      advanceLine(assemblyLineId, await productionNodeEventDeps()),
  });

  await handler(params);

  // Publish the in_progress PR check as soon as the line starts, so a required
  // `lore/code-review` check blocks merge for the whole review window (not just
  // from the first node-terminal). Best-effort — never fails the start.
  await publishStartCheck(String(params.assemblyLineId ?? ""));
};

async function publishStartCheck(assemblyLineId: string): Promise<void> {
  if (!assemblyLineId) {
    return;
  }

  try {
    const [{ assemblyLines }, { projectFor }, { publishPrCheck }] =
      await Promise.all([
        import("../../kernel/queues.js"),
        import("../../composition/project-boot.js"),
        import("./pr-check.js"),
      ]);
    const row = await assemblyLines().getById(assemblyLineId);

    if (!row || !(Number(row.args.pr_number) > 0)) {
      return;
    }
    const project = await projectFor(row.repo);

    await publishPrCheck(project.repo, row, process.env.LORE_UI_URL);
  } catch (err) {
    console.warn("[pr-check] start publish failed:", (err as Error).message);
  }
}
