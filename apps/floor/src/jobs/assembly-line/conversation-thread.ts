// Resolving a node's `continues` declaration to an actual conversation.
//
// The YAML says WHAT to continue (`node`) and WHICH THREAD it belongs to (`key`);
// this turns that into the thread a lookup can use, and decides whether this
// particular run may continue at all.

import type { ConversationThread } from "@re-cinq/lore-shared/project/conversations/conversations-port.js";

/** The run-side values a thread key can name. */
export interface ThreadContext {
  assemblyLineId: string;
  taskId: string | null;
  args: Record<string, unknown>;
}

export type ThreadResolution =
  { ok: true; thread: ConversationThread } | { ok: false; error: string };

/**
 * Turn `continues.key` into the thread to look up.
 *
 * `args.<name>` is what keeps the engine domain-free — it never learns what a
 * feature is, it just reads the value the run carries. A named arg the run does NOT
 * carry is an ERROR, not an empty thread: falling back to "no conversation" would
 * silently start fresh forever, which is indistinguishable from continuity that
 * simply remembered nothing.
 */
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

/**
 * Whether this execution may continue a previous run.
 *
 * A RETRY never continues. When the walk revisits a node through an `iteration_max`
 * back-edge it re-runs the same work with the same prompt and no inherited state:
 * a retry exists because the last attempt failed, and inheriting that attempt's
 * context would make the rerun path-dependent. Retries must be reproducible.
 */
export function mayContinue(iteration: number): boolean {
  return iteration <= 1;
}
