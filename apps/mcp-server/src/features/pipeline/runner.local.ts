// Local task runner: spawns headless Claude Code in isolated git worktrees using the developer's subscription (zero API cost). Implementation lives in runner-local-*.ts by job; this module re-exports the public surface unchanged.

export {
  type LocalRunnerConfig,
  type LocalTask,
  type PendingTask,
  readConfig,
  writeConfig,
  getRepoRoot,
  detectRepo,
  validateRepoMatch,
} from "./runner-local-storage.js";

export {
  buildTurnLines,
  batchTurnLines,
  dropOversizedTurnLines,
  ingestTurns,
} from "./runner-local-turns.js";

export {
  withLoreWorkflowPreamble,
  spawnLocalTask,
  listLocalTasks,
  cancelLocalTask,
} from "./runner-local-spawn.js";

export { cleanupStaleTasks } from "./runner-local-stale.js";

export {
  fetchPendingTasks,
  startNotifier,
  stopNotifier,
  isNotifierRunning,
  listPendingTasks,
  skipTask,
} from "./runner-local-notifier.js";
