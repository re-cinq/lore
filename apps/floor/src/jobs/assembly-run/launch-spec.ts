// The spec ONE node dispatch runs with — first launch and reaper relaunch alike; a second builder here previously dropped conversation continuity and the station-run id label on relaunch (#1466, FR-15.13), so a field added here must reach both doors or neither.

import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import {
  nodeAgentSpec,
  nodeStationSpec,
  type FloorAssemblyRunTask,
} from "./floor-assembly-run.js";
import { resolveRoundContent } from "./round-content.js";

/** Resolve a node's `continues` declaration into the conversation this run resumes and saves as. Optional seam — a composition without it never continues. */
export type ResolveConversationFn = (
  node: RunGraphNode,
  task: FloorAssemblyRunTask,
  iteration: number,
  priorOutcome: string | null,
) => Promise<LoreTaskSpec["conversation"] | undefined>;

export interface NodeLaunchDeps {
  resolvePrompt: (promptRef: string, description: string) => string;
  resolveConversation?: ResolveConversationFn;
}

export interface NodeLaunchInput {
  node: RunGraphNode;
  task: FloorAssemblyRunTask;
  iteration: number;
  stationRunId: string | undefined;
  /** How a RETRY is told from a next round — the outcome of this node's most recent RECORDED visit. Derive with {@link priorOutcomeOf}. */
  priorOutcome: string | null;
  /** The failure that routed INTO this dispatch, whichever node produced it. Derive with {@link incomingFailureOf}; null when nothing failed before it. */
  incomingFailure?: IncomingFailure | null;
  /** This node's OWN earlier failed attempts, in-run plus (on a forked run) the source runs' visits. Derive the in-run half with {@link priorFailuresOf}; the fork chain is the caller's read. */
  priorFailures?: PriorFailure[];
}

/** A preceding node's failure, as the next node needs to hear it. */
export interface IncomingFailure {
  nodeId: string;
  detail: string;
}

/** The failure that routed into the next dispatch: the most recently RECORDED visit, but only when it failed — unlike `priorOutcomeOf`, which answers for ONE node and would tell `implement` "success" while `validate` next door actually failed, starving the retry of what broke. */
export function incomingFailureOf(
  visits: ReadonlyArray<{
    nodeId: string;
    outcome: string | null;
    failureDetail?: string | null;
  }>,
): IncomingFailure | null {
  const recorded = visits.filter((v) => v.outcome !== null);
  const last = recorded[recorded.length - 1];

  if (!last || !isFailure(last.outcome) || !last.failureDetail) {
    return null;
  }

  return { nodeId: last.nodeId, detail: last.failureDetail };
}

/** Any non-success terminal outcome — `failed`, `<kind>-failed`, and the rest. */
const isFailure = (outcome: string | null): boolean =>
  outcome !== null && outcome !== "success" && outcome !== "changes_requested";

/** One earlier failed attempt of the node being launched, as its retry prompt carries it. */
export interface PriorFailure {
  nodeId: string;
  iteration: number;
  detail: string;
}

/** Every recorded FAILED visit of `nodeId` that carries a detail, oldest first — the launched node's own history, so a retry hears every earlier attempt, not only the one that just routed here. */
export function priorFailuresOf(
  visits: ReadonlyArray<{
    nodeId: string;
    iteration: number;
    outcome: string | null;
    failureDetail?: string | null;
  }>,
  nodeId: string,
): PriorFailure[] {
  return visits
    .filter(
      (v) => v.nodeId === nodeId && isFailure(v.outcome) && v.failureDetail,
    )
    .map((v) => ({
      nodeId: v.nodeId,
      iteration: v.iteration,
      detail: v.failureDetail as string,
    }));
}

/** How much of a preceding failure the next prompt carries — the backstop against a pathological detail crowding out the instructions it is appended to. */
const MAX_FEEDBACK_CHARS = 2500;

/** Append what just failed to the prompt the next node runs on. Kept separate from the prompt TEMPLATE so every agent recipe shares it rather than needing its own copy. */
export function withIncomingFailure(
  prompt: string,
  failure: IncomingFailure | null,
): string {
  if (!failure) {
    return prompt;
  }
  const detail =
    failure.detail.length > MAX_FEEDBACK_CHARS
      ? `${failure.detail.substring(0, MAX_FEEDBACK_CHARS)}\n...(truncated)`
      : failure.detail;

  return `${prompt}

## The previous step failed — fix this first

The \`${failure.nodeId}\` step failed on your last attempt. You are running
again to correct it. Read the output below, fix the cause, and do not repeat
the change that produced it.

\`\`\`
${detail}
\`\`\`
`;
}

/** The retry prompt carries at most this many earlier attempts — the most recent, closest to what the retry is about to face. */
const MAX_PRIOR_FAILURES = 3;

/** Append the launched node's own earlier failed attempts to its prompt so the agent avoids repeating them. Complements {@link withIncomingFailure} (what just routed here); empty in, prompt out untouched. */
export function withPriorFailures(
  prompt: string,
  failures: readonly PriorFailure[],
): string {
  if (failures.length === 0) {
    return prompt;
  }
  const kept = failures.slice(-MAX_PRIOR_FAILURES);
  const entries = kept
    .map((failure) => {
      const detail =
        failure.detail.length > MAX_FEEDBACK_CHARS
          ? `${failure.detail.substring(0, MAX_FEEDBACK_CHARS)}\n...(truncated)`
          : failure.detail;

      return `### Attempt ${failure.iteration}\n\n\`\`\`\n${detail}\n\`\`\``;
    })
    .join("\n\n");

  return `${prompt}

## Earlier attempts of this step failed — do not repeat them

This step has failed before. Each attempt below shows what broke. Read them,
avoid the same causes, and take a different approach where the same fix
already failed twice.

${entries}
`;
}

/** The outcome of a node's most recent RECORDED visit, or null if it never ran. An open row (no outcome yet) is the CURRENT visit, not a prior one — the reaper asks this holding the open row, and reading it as prior would tell every relaunch its last attempt had not failed. */
export function priorOutcomeOf(
  visits: ReadonlyArray<{ nodeId: string; outcome: string | null }>,
  nodeId: string,
): string | null {
  // The predicate NARROWS: "recorded" is exactly "has an outcome" — the type stops a later reader reintroducing the open row this excludes.
  const own = visits.filter(
    (v): v is { nodeId: string; outcome: string } =>
      v.nodeId === nodeId && v.outcome !== null,
  );

  return own.length ? own[own.length - 1].outcome : null;
}

/** What one dispatch resolved before anything was written: the conversation this visit continues, the round content it works from, and the prompt its pod renders (null for a station, which runs a deterministic command). */
export interface NodeDispatch {
  conversation: LoreTaskSpec["conversation"] | undefined;
  content: string;
  prompt: string | null;
}

/** Resolve what a visit is dispatched WITH, before its row is written — separate from the spec build because the station-run row is minted between the two (same module so a field added to one is visible to the other); the conversation resolves FIRST since it decides how much round content the prompt carries (FR-15.11). */
export async function resolveNodeDispatch(
  input: Omit<NodeLaunchInput, "stationRunId">,
  deps: NodeLaunchDeps,
): Promise<NodeDispatch> {
  const { node, task, iteration, priorOutcome } = input;
  // Only agent nodes hold a conversation — a station runs a deterministic command.
  const conversation =
    node.type === "agent" && deps.resolveConversation
      ? await deps.resolveConversation(node, task, iteration, priorOutcome)
      : undefined;
  const content = resolveRoundContent(task, conversation);

  const incomingFailure = input.incomingFailure ?? null;
  // The incoming failure already gets its own block — repeating it as a prior attempt would show the agent the same output twice.
  const priorFailures = (input.priorFailures ?? []).filter(
    (f) =>
      !(
        incomingFailure &&
        f.nodeId === incomingFailure.nodeId &&
        f.detail === incomingFailure.detail
      ),
  );

  return {
    conversation,
    content,
    prompt:
      node.type === "agent"
        ? withPriorFailures(
            withIncomingFailure(
              deps.resolvePrompt(node.prompt_ref ?? node.type, content),
              incomingFailure,
            ),
            priorFailures,
          )
        : null,
  };
}

/** Build the dispatch spec from an already-resolved {@link NodeDispatch}. Pure. */
export function nodeLaunchSpec(
  dispatch: NodeDispatch,
  input: NodeLaunchInput,
): LoreTaskSpec {
  const { node, task, iteration, stationRunId } = input;
  const spec =
    node.type === "agent"
      ? nodeAgentSpec(
          node,
          { ...task, description: dispatch.content },
          dispatch.prompt ?? "",
          iteration,
          stationRunId,
        )
      : nodeStationSpec(node, task, iteration, stationRunId);

  if (dispatch.conversation) {
    spec.conversation = dispatch.conversation;
  }

  return spec;
}
