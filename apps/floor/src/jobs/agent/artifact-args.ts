// A produced artifact becomes the next node's input.
//
// One node's deliverable is the next node's brief — the spec-change plan feeds the
// node that writes the specs, the decomposition feeds the station that files the
// issues. Both cross as a declared `output.watch` artifact, and both land in the
// line's `args`, which is already the channel a node reads its input from
// (`args.description`, `args.round_feedback`).
//
// Deliberately generic: the routing is the event's own name, so a new artifact needs
// a recipe declaration and a prompt, not a branch in here.

import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { parseAgentSink, type AgentFileEvent } from "./agent-events.js";

/** The features API owns this one — see deliverPlanningResult. */
const OWNED_ELSEWHERE = new Set(["planning.result"]);

export interface ArtifactArgsDeps {
  assemblyRuns: Pick<AssemblyRunsPort, "listForTask" | "mergeArgs">;
}

export type ArtifactDelivery =
  { outcome: "merged"; arg: string } | { outcome: "skipped"; error: string };

/** `spec.plan` → `spec_plan`. Every separator flattens, so an event name can never
 *  produce an arg key a consumer has to quote or a JSON path has to escape. */
export function argNameForEvent(event: string): string {
  return event.replace(/[^a-zA-Z0-9]+/g, "_");
}

/**
 * Merge one declared artifact into its line's args.
 *
 * Skips silently in three cases, none of them errors: an event another handler owns,
 * an artifact the agent never produced (the node's own outcome already reports that,
 * and there is no content to carry), and a run with no assembly line behind it — the
 * sink carries every run's artifacts, so most calls land on something this has no
 * business touching.
 */
export async function deliverArtifact(
  fileEvent: AgentFileEvent,
  deps: ArtifactArgsDeps,
): Promise<ArtifactDelivery> {
  if (OWNED_ELSEWHERE.has(fileEvent.event)) {
    return { outcome: "skipped", error: "owned by another handler" };
  }

  if (fileEvent.reason || fileEvent.content === null) {
    return { outcome: "skipped", error: `no artifact (${fileEvent.reason})` };
  }
  const line = newestOpen(
    await deps.assemblyRuns.listForTask(fileEvent.taskId),
  );

  if (!line) {
    return { outcome: "skipped", error: "no assembly line for this run" };
  }
  const arg = argNameForEvent(fileEvent.event);

  await deps.assemblyRuns.mergeArgs(line.id, { [arg]: fileEvent.content });

  return { outcome: "merged", arg };
}

/** The line a fresh artifact belongs to: the most recently started one for the task.
 *  A task re-dispatched after a crash has more than one, and the artifact came from
 *  the run that is still going. */
function newestOpen(lines: AssemblyRunRecord[]): AssemblyRunRecord | undefined {
  return [...lines]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .at(-1);
}

/** What one terminal status says about the artifacts its node declared: the args
 *  to merge, and the names of any the agent never produced. */
export interface TerminalArtifacts {
  args: Record<string, string>;
  /** `<event> (<reason>)` per declared-but-absent artifact — the node's failure
   *  detail, because advancing without it hands the next node an empty bag. */
  missing: string[];
}

/**
 * The artifacts carried by an Agent CR's RAW terminal output.
 *
 * The sink these events normally arrive on is a separate HTTP post racing the
 * Kubernetes event the walk advances on, so nothing ordered the merge before the
 * next node's dispatch — the next station could read an arg the pod had already
 * produced and simply not find it. The same events are in `status.output`, which
 * the terminal handler already reads, so delivery can ride the advancing event
 * instead of hoping to beat it. Merging the same content twice is a no-op, which
 * is what lets the sink stay the fast path.
 *
 * Must be given the RAW output: `normalizeAgentStatus` replaces it with the
 * agent's result text, which no longer parses as a stream.
 */
export function artifactsFromTerminalOutput(
  rawOutput: string | undefined,
): TerminalArtifacts {
  const args: Record<string, string> = {};
  const missing: string[] = [];

  for (const fileEvent of parseAgentSink(rawOutput ?? "", false, false)
    .fileEvents) {
    if (OWNED_ELSEWHERE.has(fileEvent.event)) {
      continue;
    }

    if (fileEvent.content !== null) {
      args[argNameForEvent(fileEvent.event)] = fileEvent.content;
    } else {
      missing.push(
        `${fileEvent.event} (${fileEvent.reason ?? "not produced"})`,
      );
    }
  }

  return { args, missing };
}
