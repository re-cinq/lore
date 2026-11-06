-- 0066_close_stranded_station_runs: close visits left open under runs that
-- already finished.
--
-- The reaper sweeps `listOpen()` runs only, so a visit still open when its run
-- went terminal was never revisited by anything — 86 rows had been stranded
-- since 2026-08-21 (63 comment-triage, 16 code-review, 7 code-review-recheck),
-- and nothing in the system would ever have closed them. They are not merely
-- untidy: the spend page prices a visit with no `finished_at` at up to its
-- two-hour cap, so each stranded row billed phantom pod-hours on every page
-- load, forever.
--
-- `PgAssemblyRuns.finish` now closes them in the same statement that closes the
-- run; this is the one-time backfill for rows that predate that.
--
-- Idempotent by construction: it only touches rows whose run is terminal and
-- whose `finished_at` is still null, and it sets that column — a re-run matches
-- nothing. A visit that DID report keeps its own outcome (COALESCE), so the
-- backfill cannot rewrite a real verdict.

UPDATE pipeline.station_runs sr
   SET finished_at = COALESCE(ar.finished_at, now()),
       outcome = COALESCE(sr.outcome, 'failed'),
       failure_class = COALESCE(sr.failure_class, 'unknown'),
       failure_detail = COALESCE(
         sr.failure_detail,
         'the run finished while this visit was still open — the visit never reported an outcome'
       )
  FROM pipeline.assembly_runs ar
 WHERE ar.id = sr.assembly_run_id
   AND sr.finished_at IS NULL
   AND ar.status IN ('finished', 'failed', 'cancelled');
