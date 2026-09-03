// Dispatch-time resolution of node `continues` declaration: resume id and save id pair (save always NEW).

import { randomUUID } from "node:crypto";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type {
  ConversationsPort,
  ExecutionRef,
} from "@re-cinq/lore-shared/project/conversations/conversations-port.js";
import type { FloorAssemblyRunTask } from "./floor-assembly-run.js";
import { mayContinue, resolveThread } from "./conversation-thread.js";

export interface ResolveConversationDeps {
  conversations: ConversationsPort;
  /** Floor conversation registry URL; pod must reach it. */
  registryUrl: string;
  /** agent-secrets key for registry Authorization header. */
  headersSecret: string;
  /** Override id for this run's save; defaults to fresh uuid. */
  newId?: () => string;
  /** Assembly lines task ran, for resume_from_task (rewind); optional seam. */
  linesForTask?: (taskId: string) => Promise<string[]>;
}

/** Specific execution to resume when rewound: iteration or task (null if no rewind). */
async function rewindTarget(
  task: FloorAssemblyRunTask,
  deps: ResolveConversationDeps,
): Promise<ExecutionRef | null> {
  const rewoundTo = task.args?.resume_from_iteration;

  // Explicitly null to prevent stale rewind value steering later rounds.
  if (rewoundTo !== undefined && rewoundTo !== null) {
    return typeof rewoundTo === "number"
      ? { assemblyLineId: task.assemblyLineId, iteration: rewoundTo }
      : { assemblyLineId: NO_SUCH_LINE };
  }
  const from = task.args?.resume_from_task;

  if (typeof from !== "string" || !from || !deps.linesForTask) {
    return null;
  }
  const lines = await deps.linesForTask(from);

  // Newest line: listForTask orders created_at DESC, so first element is what author saw.
  return lines.length
    ? { assemblyLineId: lines[0] }
    : { assemblyLineId: NO_SUCH_LINE };
}

/** Fake id for "round that ran no line": resolves to nothing, never falls through to newest. */
const NO_SUCH_LINE = "00000000-0000-0000-0000-000000000000";

/** Conversation wiring for node execution or undefined; priorOutcome REQUIRED (see test). */
export interface ConversationVisit {
  iteration: number;
  /** Outcome of this node's most recent visit — how a retry is told from a round. */
  priorOutcome: string | null;
}

export async function resolveConversation(
  node: RunGraphNode,
  task: FloorAssemblyRunTask,
  { iteration, priorOutcome }: ConversationVisit,
  deps: ResolveConversationDeps,
): Promise<LoreTaskSpec["conversation"] | undefined> {
  if (!node.continues || !mayContinue(priorOutcome)) {
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

  const from = await rewindTarget(task, deps);
  // Never continue THIS EXECUTION's own: exclude (line, iteration) so re-dispatch doesn't resume itself.
  const prior = await deps.conversations.latestFor(resolved.thread, {
    exclude: { assemblyLineId: task.assemblyLineId, iteration },
    ...(from ? { from } : {}),
  });
  const pin = (deps.newId ?? randomUUID)();

  // Reserved in advance: pod is TOLD what to save as, keeping path deterministic.
  await deps.conversations.reserve({
    thread: resolved.thread,
    conversationId: pin,
    assemblyLineId: task.assemblyLineId,
    iteration,
  });

  return {
    source: deps.registryUrl,
    id: prior?.conversationId ?? "",
    pin,
    headersSecret: deps.headersSecret,
  };
}
