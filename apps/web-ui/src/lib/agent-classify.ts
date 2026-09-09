// task_count > 0 means task agent (claims pipeline tasks); the two kinds never overlap, so presence is the whole signal.
export type AgentKind = "local" | "task";

export function classifyAgent(row: { task_count: number }): AgentKind {
  return row.task_count > 0 ? "task" : "local";
}
