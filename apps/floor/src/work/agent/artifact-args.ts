// A produced artifact becomes the next node's input, landing in the line's `args` (the same channel `args.description`/`args.round_feedback` use); routing is deliberately generic on the event's own name, so a new artifact needs only a recipe declaration and a prompt, not a branch here.

import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { parseAgentSink, type AgentFileEvent } from "./agent-events.js";

/** Written into its plan, not the line — see deliverPlanningResult. */
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

/** The args one artifact lands as: itself under its event's name, plus the spec a spec plan is chiefly about (`spec_path`), which the issues station stamps onto every spec-task so the merge-check knows which spec's status to flip. */
export function argsForArtifact(
  event: string,
  content: string,
): Record<string, string> {
  const own = { [argNameForEvent(event)]: content };

  return event === SPEC_PLAN_EVENT ? { ...own, ...specPathOf(content) } : own;
}

const SPEC_PLAN_EVENT = "spec.plan";

// The first spec the plan creates, else the first it updates; nothing when the plan does not parse.
function specPathOf(content: string): { spec_path?: string } {
  const plan = parseSpecPlan(content);
  const path = firstPath(plan?.creates) ?? firstPath(plan?.updates);

  return path ? { spec_path: path } : {};
}

function firstPath(entries: SpecPlanPaths["creates"]): string | undefined {
  const path = entries?.[0]?.path;

  return typeof path === "string" ? path : undefined;
}

interface SpecPlanPaths {
  creates?: Array<{ path?: unknown }>;
  updates?: Array<{ path?: unknown }>;
}

function parseSpecPlan(content: string): SpecPlanPaths | null {
  try {
    return JSON.parse(content) as SpecPlanPaths;
  } catch {
    return null;
  }
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
  const args = argsForArtifact(fileEvent.event, fileEvent.content);

  await deps.assemblyRuns.mergeArgs(line.id, args);

  return { outcome: "merged", arg: argNameForEvent(fileEvent.event) };
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

  const projections = { projectRunEvents: false, collectTurns: false };

  for (const fileEvent of parseAgentSink(rawOutput ?? "", projections)
    .fileEvents) {
    collect(fileEvent, { args, missing });
  }

  return { args, missing };
}

// A failure fails the node whoever owns the file: a planning pass whose plan.md never landed did not do its work.
function collect(fileEvent: AgentFileEvent, found: TerminalArtifacts): void {
  if (!delivered(fileEvent)) {
    found.missing.push(
      `${fileEvent.event} (${fileEvent.reason ?? "not produced"})`,
    );

    return;
  }

  if (fileEvent.content !== null && !OWNED_ELSEWHERE.has(fileEvent.event)) {
    Object.assign(
      found.args,
      argsForArtifact(fileEvent.event, fileEvent.content),
    );
  }
}

// Produced and handed over: inline content, or uploaded to the endpoint that owns it.
function delivered(fileEvent: AgentFileEvent): boolean {
  return (
    !fileEvent.reason && (fileEvent.content !== null || fileEvent.uploaded)
  );
}
