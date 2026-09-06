// A produced artifact becomes the next node's input, landing in the line's `args` (the same channel `args.description`/`args.round_feedback` use); routing is deliberately generic on the event's own name, so a new artifact needs only a recipe declaration and a prompt, not a branch here.

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

/** `spec.plan` → `spec_plan`; every separator flattens, so no arg key ever needs quoting or JSON-path escaping. */
export function argNameForEvent(event: string): string {
  return event.replace(/[^a-zA-Z0-9]+/g, "_");
}

/** Merge one declared artifact into its line's args; skips silently for an event owned elsewhere, an artifact never produced, or a run with no assembly line behind it. */
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

/** The line a fresh artifact belongs to: the most recently started one for the task, since a crash-redispatched task has more than one and the artifact came from the run still going. */
function newestOpen(lines: AssemblyRunRecord[]): AssemblyRunRecord | undefined {
  return [...lines]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .at(-1);
}

/** What one terminal status says about the artifacts its node declared: the args to merge, and the names of any the agent never produced. */
export interface TerminalArtifacts {
  args: Record<string, string>;
  /** `<event> (<reason>)` per declared-but-absent artifact, since advancing without it hands the next node an empty bag. */
  missing: string[];
}

/** Artifacts carried by an Agent CR's RAW terminal output — rides the advancing Kubernetes event instead of racing the sink's separate HTTP post; must be RAW since `normalizeAgentStatus` replaces it with result text that no longer parses as a stream. */
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
      continue;
    }
    missing.push(`${fileEvent.event} (${fileEvent.reason ?? "not produced"})`);
  }

  return { args, missing };
}
