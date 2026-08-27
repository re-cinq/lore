// The spec ONE node dispatch runs with — first launch and reaper relaunch alike.
//
// There were two builders. The walk's (advance.ts) resolved the node's conversation
// and composed the round content; the reaper's rebuilt the spec field by field from
// the raw task description and forgot both. Every launch re-provisions the per-task
// recipe clone, so a relaunch did not merely dispatch a thinner pod — it REPLACED a
// live pod's recipe with one that had no conversation, silently ending continuity
// (#1466). That is FR-15.13's disease exactly, and its third victim: the station-run
// id label was lost the same way, from the same second builder.
//
// So there is one builder. A field added here reaches both doors, or neither.

import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import {
  nodeAgentSpec,
  nodeStationSpec,
  type FloorAssemblyRunTask,
} from "./floor-assembly-run.js";
import { resolveRoundContent } from "./round-content.js";

/** Resolve a node's `continues` declaration into the conversation this run resumes
 *  and saves as. Optional seam — a composition without it never continues. */
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
  /** How a RETRY is told from a next round — the outcome of this node's most recent
   *  RECORDED visit. Callers derive it with {@link priorOutcomeOf}. */
  priorOutcome: string | null;
  /** The failure that routed INTO this dispatch, whichever node produced it.
   *  Derive with {@link incomingFailureOf}. Null when nothing failed before it. */
  incomingFailure?: IncomingFailure | null;
}

/** A preceding node's failure, as the next node needs to hear it. */
export interface IncomingFailure {
  nodeId: string;
  detail: string;
}

/**
 * The failure that routed into the next dispatch: the most recently RECORDED
 * visit, but only when it failed.
 *
 * Not `priorOutcomeOf`, which answers for ONE node and so tells `implement`
 * about its own last visit — "success", every time, while the thing that
 * actually failed was `validate` next door. That is why the loop could not
 * converge: the retried agent was handed the identical prompt and never told
 * what broke. The most recent visit is the one that just routed here, so its
 * failure is the one this dispatch exists to fix.
 */
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

/** How much of a preceding failure the next prompt carries. The detail is
 *  already bounded upstream; this is the backstop against a pathological one
 *  crowding out the instructions it is appended to. */
const MAX_FEEDBACK_CHARS = 2500;

/**
 * Append what just failed to the prompt the next node runs on.
 *
 * Kept separate from the prompt TEMPLATE deliberately: every agent recipe would
 * otherwise need its own copy of this, and a recipe that forgot would silently
 * go back to guessing.
 */
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

/**
 * The outcome of a node's most recent RECORDED visit, or null if it never ran.
 *
 * An open row (no outcome yet) is the CURRENT visit, not a prior one — the walk asks
 * this before minting its row and so never sees one, but the reaper asks it holding
 * the open row, and reading that as the prior outcome would tell every relaunch its
 * last attempt had not failed.
 */
export function priorOutcomeOf(
  visits: ReadonlyArray<{ nodeId: string; outcome: string | null }>,
  nodeId: string,
): string | null {
  // The predicate NARROWS: "recorded" is exactly "has an outcome", and saying so in
  // the type is what stops a later reader reintroducing the open row this excludes.
  const own = visits.filter(
    (v): v is { nodeId: string; outcome: string } =>
      v.nodeId === nodeId && v.outcome !== null,
  );

  return own.length ? own[own.length - 1].outcome : null;
}

/**
 * Build one node dispatch's spec.
 *
 * Order matters: the conversation is resolved BEFORE the prompt, because whether
 * this run resumes one decides how much round content the prompt must carry
 * (FR-15.11) — a resumed round sends only the author's new feedback, a fresh one the
 * whole composition.
 */
/** What one dispatch resolved before anything was written: the conversation this
 *  visit continues, the round content it works from, and the prompt its pod
 *  renders (null for a station, which runs a deterministic command). */
export interface NodeDispatch {
  conversation: LoreTaskSpec["conversation"] | undefined;
  content: string;
  prompt: string | null;
}

/**
 * Resolve what a visit is dispatched WITH, before its row is written.
 *
 * Separate from the spec build because the station-run row is minted between the
 * two — it records this exact input, and it mints the id the spec's labels carry.
 * Both halves stay in one module so a field added to one is visible to the other.
 *
 * The conversation is resolved FIRST: whether this run resumes one decides how
 * much round content the prompt must carry (FR-15.11) — a resumed round sends
 * only the author's new feedback, a fresh one the whole composition.
 */
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

  return {
    conversation,
    content,
    prompt:
      node.type === "agent"
        ? withIncomingFailure(
            deps.resolvePrompt(node.prompt_ref ?? node.type, content),
            input.incomingFailure ?? null,
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
