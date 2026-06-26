// Single source of truth for which task statuses are still cancellable. A task
// is cancellable only while it is in flight; once it reaches a terminal state
// there is nothing to cancel. Mirrors the mcp-server /api/task guard
// (status NOT IN completed/merged/failed/cancelled) so both cancel paths agree.

const TERMINAL_TASK_STATUSES = new Set(['completed', 'merged', 'failed', 'cancelled']);

export function isCancellable(status: string): boolean {
  return !TERMINAL_TASK_STATUSES.has(status);
}
