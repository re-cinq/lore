// Dispatch-time resolution of a node's `continues` declaration.
//
// Turns "continue node X on thread Y" into the concrete pair the pod needs: the id to
// resume, and the id to save its own state as. The save id is always NEW — that is
// what makes each run a fork, leaving the run it continued intact and independently
// resumable, which is what lets an author rewind to an earlier round.

import { randomUUID } from "node:crypto";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { AssemblyLine } from "@re-cinq/lore-assembly-lines";
import type { ConversationsPort } from "@re-cinq/lore-shared/project/conversations/conversations-port.js";
import type { FloorAssemblyLineTask } from "./floor-assembly-line.js";
import { mayContinue, resolveThread } from "./conversation-thread.js";

export interface ResolveConversationDeps {
  conversations: ConversationsPort;
  /** Base URL of the Floor's conversation registry, as the POD must reach it. */
  registryUrl: string;
  /** agent-secrets key holding the registry's Authorization header. */
  headersSecret: string;
  /** Override for the id this run saves as; defaults to a fresh uuid. */
  newId?: () => string;
}

/**
 * The conversation wiring for one node execution, or undefined when this run should
 * not continue anything.
 *
 * Undefined for: a node that declares no `continues`, a retry (which must re-run the
 * same work reproducibly rather than inherit a failed attempt's context), and a
 * thread key the run cannot satisfy — the last is logged, because a definition
 * naming an arg the run does not carry is a wiring bug, not a fresh conversation.
 */
export async function resolveConversation(
  node: AssemblyLine["nodes"][number],
  task: FloorAssemblyLineTask,
  iteration: number,
  deps: ResolveConversationDeps,
): Promise<LoreTaskSpec["conversation"] | undefined> {
  if (!node.continues || !mayContinue(iteration)) {
    return undefined;
  }
  const resolved = resolveThread(node.continues.key, node.continues.node, {
    assemblyLineId: task.assemblyLineId,
    taskId: task.pipelineTaskId,
    args: task.args ?? {},
  });

  if (!resolved.ok) {
    console.warn(
      `[conversation] node "${node.id}" of ${task.taskType}: ${resolved.error}`,
    );

    return undefined;
  }

  // Never continue this line's own conversation: a re-dispatch of the same run must
  // not resume itself.
  const prior = await deps.conversations.latestFor(resolved.thread, {
    excludeAssemblyLineId: task.assemblyLineId,
  });
  const pin = (deps.newId ?? randomUUID)();

  // Reserved before the run so the id is known in advance — the pod is TOLD what to
  // save as rather than reporting back, which is what keeps the path deterministic
  // for a CLI that accepts a pinned id.
  await deps.conversations.reserve({
    thread: resolved.thread,
    conversationId: pin,
    assemblyLineId: task.assemblyLineId,
  });

  return {
    source: deps.registryUrl,
    id: prior?.conversationId ?? "",
    pin,
    headersSecret: deps.headersSecret,
  };
}
