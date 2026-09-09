// Task cancellability gate: only in-flight tasks (mirrors mcp-server /api/task guard).

const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "merged",
  "failed",
  "cancelled",
]);

export function isCancellable(status: string): boolean {
  return !TERMINAL_TASK_STATUSES.has(status);
}
