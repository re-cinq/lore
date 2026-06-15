// Splits agents into the two kinds the UI cares about. A task agent claims
// pipeline tasks (ephemeral, audit-only); a local MCP agent only ever writes
// memories over the stdio MCP server (the developer's stable ~/.lore/agent-id).
// The two never overlap, so task-count presence is the whole signal.

export type AgentKind = 'local' | 'task';

export function classifyAgent(row: { task_count: number }): AgentKind {
  return row.task_count > 0 ? 'task' : 'local';
}
