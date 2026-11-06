-- 0041_assembly_runs_subject_key: let a run declare WHAT IT IS WORKING ON, so at
-- most one run can work a given subject at a time and callers can ask "what is
-- running for this thing" (specs/6-dark-factory FR6.45–FR6.47).
--
-- The problem this fixes. The only in-flight guard we had was keyed on
-- repo + branch (apps/floor/src/jobs/assembly-run/advance.ts). Task-driven lines
-- mint `lore/<type>/<slug>-<taskid8>` — a DIFFERENT branch per task — so any
-- caller that creates a task per click could start unbounded concurrent runs on
-- the same work. On 2026-08-19 four clicks of "Create spec PR" on one feature
-- produced four feature-finalize runs and three duplicate spec PRs, two of them
-- writing different content to the same spec path.
--
-- `branch` was carrying two jobs: a git ref, and a lease key. This separates
-- them. The branch stays a branch; subject_key is the identity of the WORK.
--
-- The key names the SUBJECT, never the action — `feature:<uuid>`, not
-- `feature:<uuid>:finalize`. That is what lets ONE query find a feature's
-- planning run and its finalize run, and what makes "two lines on one feature"
-- impossible rather than merely "two finalizes".
--
-- Nullable, and the index is partial on it: a run with no key is unconstrained.
-- Lines that are MEANT to overlap (comment-triage and code-review-reply carry
-- distinct human comments on one PR branch) simply declare no subject. Opting IN
-- by passing a key replaces the old opt-out-by-blueprint-name list.

ALTER TABLE pipeline.assembly_runs
  ADD COLUMN IF NOT EXISTS subject_key TEXT;

-- Backfill is exact rather than inferred: every run started for a feature already
-- carries args.feature_id, written by AssemblyLineStationBackend.launch. Existing
-- features therefore keep working the moment this lands — their planning runs
-- become findable by subject without anything re-running.
UPDATE pipeline.assembly_runs
   SET subject_key = 'feature:' || (args->>'feature_id')
 WHERE subject_key IS NULL
   AND args ? 'feature_id'
   AND args->>'feature_id' <> '';

-- Settle rows the backfill has just made duplicates of, so the unique index below
-- can be built. These are the runs that only exist BECAUSE nothing guarded the
-- subject — the duplicate-click storms this migration exists to prevent. Keep the
-- oldest open run per subject (the one whose work the others were racing) and
-- close the rest; `superseded` is a settle, not a failure, because the work was
-- real and its artifacts (branches, PRs) still exist and still need triage.
--
-- Without this the CREATE UNIQUE INDEX below fails on any database that has ever
-- seen a duplicate, which today includes production.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY repo, subject_key
           ORDER BY created_at, id
         ) AS rank
    FROM pipeline.assembly_runs
   WHERE subject_key IS NOT NULL
     AND status IN ('queued', 'running')
)
UPDATE pipeline.assembly_runs a
   SET status = 'finished',
       outcome = 'superseded',
       reason = 'settled by migration 0041: another run already held this subject',
       finished_at = now()
  FROM ranked
 WHERE a.id = ranked.id
   AND ranked.rank > 1;

-- The guard. Partial twice over: closed runs never collide (a subject is freed
-- when its run settles), and a NULL key opts out entirely.
CREATE UNIQUE INDEX IF NOT EXISTS assembly_runs_subject_inflight
    ON pipeline.assembly_runs (repo, subject_key)
 WHERE subject_key IS NOT NULL
   AND status IN ('queued', 'running');

-- The read. "Every run for this subject, newest first" — the query the feature
-- page uses instead of resolving a run through a task id and a blueprint name.
CREATE INDEX IF NOT EXISTS assembly_runs_subject_idx
    ON pipeline.assembly_runs (repo, subject_key, created_at DESC)
 WHERE subject_key IS NOT NULL;
