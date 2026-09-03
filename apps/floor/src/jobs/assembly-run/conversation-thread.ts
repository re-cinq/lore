// Resolves a node's `continues` declaration (YAML's `node` + `key`) to the actual conversation thread and whether this run may continue it.

import type { ConversationThread } from "@re-cinq/lore-shared/project/conversations/conversations-port.js";

/** The run-side values a thread key can name. */
export interface ThreadContext {
  assemblyLineId: string;
  taskId: string | null;
  args: Record<string, unknown>;
}

export type ThreadResolution =
  { ok: true; thread: ConversationThread } | { ok: false; error: string };

/** Turns `continues.key` into the thread to look up; a named arg the run does NOT carry is an ERROR, not an empty thread, since silently starting fresh is indistinguishable from remembering nothing. */
export function resolveThread(
  key: string,
  nodeId: string,
  ctx: ThreadContext,
): ThreadResolution {
  if (key === "line") {
    return {
      ok: true,
      thread: { kind: "line", value: ctx.assemblyLineId, nodeId },
    };
  }

  if (key === "task") {
    return ctx.taskId
      ? { ok: true, thread: { kind: "task", value: ctx.taskId, nodeId } }
      : { ok: false, error: `continues.key "task" but the line has no task` };
  }

  if (!key.startsWith("args.")) {
    return { ok: false, error: `unsupported continues.key "${key}"` };
  }
  const name = key.slice("args.".length);
  const value = ctx.args[name];

  if (typeof value !== "string" || value.length === 0) {
    return {
      ok: false,
      error: `continues.key "${key}" but the run carries no ${name}`,
    };
  }

  return { ok: true, thread: { kind: "args", value, nodeId } };
}

/** Whether this execution may continue a previous run's conversation, given this node's most recent outcome — a RETRY never continues (must be reproducible); tests WHY it's revisited, not iteration count, since rounds (FR6.21) are revisits too. */
export function mayContinue(priorOutcome: string | null): boolean {
  return !(priorOutcome ?? "").includes("failed");
}
