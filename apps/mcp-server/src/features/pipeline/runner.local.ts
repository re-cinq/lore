// Local task runner: spawns headless Claude Code in isolated git worktrees using the developer's subscription (zero API cost). Implementation lives in runner-local-*.ts by job; this module re-exports the public surface unchanged.

// eslint-disable-next-line lore/no-reexport-only-module -- the folder's lazy-loaded surface: ten call sites `await import()` this exact path to keep laptop-only code out of the agent build, and ten specs name it as the module.
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
