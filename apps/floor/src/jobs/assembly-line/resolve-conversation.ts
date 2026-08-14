// Dispatch-time resolution of a node's `continues` declaration.
//
// Turns "continue node X on thread Y" into the concrete pair the pod needs: the id to
// resume, and the id to save its own state as. The save id is always NEW — that is
// what makes each run a fork, leaving the run it continued intact and independently
// resumable, which is what lets an author rewind to an earlier round.

import { randomUUID } from "node:crypto";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { SnapshotNode } from "@re-cinq/lore-assembly-lines";
import type {
  ConversationsPort,
  ExecutionRef,
} from "@re-cinq/lore-shared/project/conversations/conversations-port.js";
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
  /** The assembly lines a task ran, for `args.resume_from_task` (rewind). Optional
   *  seam — a composition without it simply never rewinds. */
  linesForTask?: (taskId: string) => Promise<string[]>;
}

/**
 * The specific execution to resume, when the author rewound to an earlier round.
 *
 * Two shapes, because a round is addressed by whatever the caller holds. On a line
 * whose rounds are REVISITS the round is an iteration of this very line, and a
 * resumed round mints no task to name it by (FR6.22) — so `resume_from_iteration`
 * is the only handle. The older shape, one line per round, still names the round by
 * the task it ran as. Null when the run rewound to nothing.
 */
async function rewindTarget(
  task: FloorAssemblyLineTask,
  deps: ResolveConversationDeps,
): Promise<ExecutionRef | null> {
  const rewoundTo = task.args?.resume_from_iteration;

  // Explicitly null when the author did NOT rewind, so a stale value from an earlier
  // round cannot keep steering later ones.
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

  // The newest line for that task: a retried round ran more than one, and the last
  // is the attempt whose state the author actually saw.
  return lines.length
    ? { assemblyLineId: lines[lines.length - 1] }
    : { assemblyLineId: NO_SUCH_LINE };
}

/** Stands in for "the author named a round that ran no line". Not a real id, so it
 *  matches no conversation — which is the point: an explicit choice that resolves to
 *  nothing must start fresh, never fall through to the newest round. */
const NO_SUCH_LINE = "00000000-0000-0000-0000-000000000000";

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
  node: SnapshotNode,
  task: FloorAssemblyLineTask,
  iteration: number,
  deps: ResolveConversationDeps,
  /** Outcome of this node's most recent visit — how a retry is told from a round.
   *  REQUIRED, deliberately: with a default, the production wiring passed a
   *  three-parameter lambda and TypeScript accepted it (fewer params is assignable),
   *  so every retry silently inherited the failed attempt's context while the unit
   *  tests — which call this directly — stayed green. */
  priorOutcome: string | null,
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
  // Never continue THIS EXECUTION's own conversation: a re-dispatch of the same run
  // must not resume itself. Scoped to (line, iteration) rather than the line, or a
  // line whose rounds are revisits excludes every earlier round of itself — which is
  // the whole conversation, silently.
  // Excluding THIS (line, iteration) cannot hide a sibling: exactly one dispatch runs
  // per node execution — the row is written before the CR and the walk is replayed from
  // it — so the only conversation this pair can name is the one this run is about to
  // reserve below.
  const prior = await deps.conversations.latestFor(resolved.thread, {
    exclude: { assemblyLineId: task.assemblyLineId, iteration },
    ...(from ? { from } : {}),
  });
  const pin = (deps.newId ?? randomUUID)();

  // Reserved before the run so the id is known in advance — the pod is TOLD what to
  // save as rather than reporting back, which is what keeps the path deterministic
  // for a CLI that accepts a pinned id.
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
