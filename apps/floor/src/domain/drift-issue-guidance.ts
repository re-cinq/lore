/** Static guidance appended to the issue body *after* the LLM copy pass (which compresses the body and strips trailers), so it can't live in the task description. */

export interface DriftTaskLike {
  task_type?: string;
  context_bundle?: { spec_path?: string; [k: string]: unknown } | null;
}

/** A drift issue is a gap-fill task that names the spec it was filed against. */
export function isDriftTask(task: DriftTaskLike): boolean {
  return task.task_type === "gap-fill" && !!task.context_bundle?.spec_path;
}

export const DRIFT_ISSUE_GUIDANCE = `**What you should actually do**

- Decide the direction first: is the spec stale, or is the code wrong? For a
  reconstruction-grade spec the answer is almost always "update the spec".
- If you update the spec, fix the diverged items above and re-verify every
  \`([validated by …](…))\` link and \`#Lnn\` anchor on the statements you touch.
- If this is a false positive — the named items are endpoints, fields, or methods
  rather than top-level symbols, and the behaviour still matches — close this as
  stale rather than editing the spec.`;
