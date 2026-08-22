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
import { roundContent } from "./round-content.js";

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
export async function nodeLaunchSpec(
  input: NodeLaunchInput,
  deps: NodeLaunchDeps,
): Promise<LoreTaskSpec> {
  const { node, task, iteration, stationRunId, priorOutcome } = input;
  // Only agent nodes hold a conversation — a station runs a deterministic command.
  const conversation =
    node.type === "agent" && deps.resolveConversation
      ? await deps.resolveConversation(node, task, iteration, priorOutcome)
      : undefined;
  const content = roundContent(task, conversation);
  const spec =
    node.type === "agent"
      ? nodeAgentSpec(
          node,
          { ...task, description: content },
          deps.resolvePrompt(node.prompt_ref ?? node.type, content),
          iteration,
          stationRunId,
        )
      : nodeStationSpec(node, task, iteration, stationRunId);

  if (conversation) {
    spec.conversation = conversation;
  }

  return spec;
}
