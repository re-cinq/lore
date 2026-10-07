-- 0105_retire_spec_tasks: the `spec-task` task type is retired, and nothing
-- dispatches one any more.
--
-- The spec-task executor read `pipeline.tasks` every minute and started an
-- `implementation-loop` run per ready row, with no per-repository opt-in: it
-- never read `lore.repos.settings`, so switching the backlog loop off left it
-- running. It is deleted, and a plan's tasks now reach the backlog loop as
-- tickets — the `issues` station files each task issue with a priority label.
--
-- Rows left `pending` or `running` are unreachable: `findReadySpecTasks` and
-- `claimSpecTask` are gone, and the generic `claimNextPending` never took a
-- spec-task. They would sit `pending` forever, counted by nothing and invisible
-- to the loop. So they are CANCELLED here rather than deleted: the row is the
-- audit record of work that was queued and never run, and its task issue is a
-- real Issue somebody may still want.
--
-- `completed` and `merged` rows are left exactly as they are. The merge sweep
-- still settles a completed spec-task, and `countUnmergedInGroup` still reads
-- their group for the (now dormant) spec-status flip.
--
-- No `lore.agent_definitions` rows to remove, unlike 0094: there was never a
-- spec-task agent file. The executor started an `implementation-loop` run, so
-- it reused the `loop-*` definitions, which stay.

UPDATE pipeline.tasks
   SET status = 'cancelled',
       failure_reason = 'The spec-task executor was removed; a plan''s tasks are implemented from the repository''s backlog by the implementation loop. Re-queue this one by adding a priority label to its task issue.',
       updated_at = now()
 WHERE task_type = 'spec-task'
   AND status IN ('pending', 'running');
