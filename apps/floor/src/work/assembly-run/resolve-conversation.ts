// Dispatch-time resolution of node `continues` declaration: resume id and save id pair (save always NEW).

import type { ConversationThread } from "@re-cinq/lore-shared/project/conversations/conversations-port.js";
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
  const resolved = threadFor(node.continues, task);

  if (!resolved.ok) {
    console.warn(
      `[conversation] node "${node.id}" of ${task.taskType}: ${resolved.error}`,
    );

    return undefined;
  }

  return pinConversation(resolved.thread, task, iteration, deps);
}

/** The thread this node's `continues` declaration names, resolved against the run's identity. */
function threadFor(
  continues: NonNullable<RunGraphNode["continues"]>,
  task: FloorAssemblyRunTask,
): ReturnType<typeof resolveThread> {
  return resolveThread(continues.key, continues.node, {
    assemblyLineId: task.assemblyLineId,
    taskId: task.pipelineTaskId,
    args: taskArgs(task),
  });
}

/** Picks the conversation to continue and reserves the id this run will save as. */
async function pinConversation(
  thread: ConversationThread,
  task: FloorAssemblyRunTask,
  iteration: number,
  deps: ResolveConversationDeps,
): Promise<LoreTaskSpec["conversation"]> {
  const id = await priorConversationId(thread, task, iteration, deps);
  const pin = await reserveSaveId(thread, task, iteration, deps);

  return {
    source: deps.registryUrl,
    id,
    pin,
    headersSecret: deps.headersSecret,
  };
}

/** The conversation this run continues, or "" when there is none. The run NEVER continues its own execution — (line, iteration) is excluded, or a re-dispatch would resume itself. */
async function priorConversationId(
  thread: ConversationThread,
  task: FloorAssemblyRunTask,
  iteration: number,
  deps: ResolveConversationDeps,
): Promise<string> {
  const from = await rewindTarget(task, deps);
  const prior = await deps.conversations.latestFor(thread, {
    exclude: { assemblyLineId: task.assemblyLineId, iteration },
    ...(from ? { from } : {}),
  });

  return prior?.conversationId ?? "";
}

/** Reserves the id this run will save as, in ADVANCE, so the pod is told what to save as rather than choosing a path the Floor would then have to discover. */
async function reserveSaveId(
  thread: ConversationThread,
  task: FloorAssemblyRunTask,
  iteration: number,
  deps: ResolveConversationDeps,
): Promise<string> {
  const pin = (deps.newId ?? randomUUID)();

  await deps.conversations.reserve({
    thread,
    conversationId: pin,
    assemblyLineId: task.assemblyLineId,
    iteration,
  });

  return pin;
}

/** Specific execution to resume when rewound: iteration or task (null if no rewind). */
async function rewindTarget(
  task: FloorAssemblyRunTask,
  deps: ResolveConversationDeps,
): Promise<ExecutionRef | null> {
  const fromIteration = iterationRewind(task);

  if (fromIteration !== undefined) {
    return fromIteration;
  }

  return taskRewind(task, deps);
}

// Explicitly undefined vs null: null means "resolved, no rewind"; undefined means "not this path".
function iterationRewind(
  task: FloorAssemblyRunTask,
): ExecutionRef | null | undefined {
  const rewoundTo = taskArgs(task).resume_from_iteration;

  if (rewoundTo === undefined || rewoundTo === null) {
    return undefined;
  }

  return typeof rewoundTo === "number"
    ? { assemblyLineId: task.assemblyLineId, iteration: rewoundTo }
    : { assemblyLineId: NO_SUCH_LINE };
}

async function taskRewind(
  task: FloorAssemblyRunTask,
  deps: ResolveConversationDeps,
): Promise<ExecutionRef | null> {
  const from = taskArgs(task).resume_from_task;

  if (typeof from !== "string" || !from || !deps.linesForTask) {
    return null;
  }
  const lines = await deps.linesForTask(from);

  // Newest line: listForTask orders created_at DESC, so first element is what author saw.
  return lines.length
    ? { assemblyLineId: lines[0] }
    : { assemblyLineId: NO_SUCH_LINE };
}

function taskArgs(task: FloorAssemblyRunTask): Record<string, unknown> {
  return task.args ?? {};
}

/** Fake id for "round that ran no line": resolves to nothing, never falls through to newest. */
const NO_SUCH_LINE = "00000000-0000-0000-0000-000000000000";
