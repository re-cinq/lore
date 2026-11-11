-- 0125_audit_log_pr_merged_unique: at most one pr_merged row per (repo, prNumber) (#3300).
--
-- Overlapping deliveries of the same merged pull_request.closed event can both
-- pass recorded() before either INSERT runs, which would double-count the PR in
-- pipeline.v_auto_merge_kpis. Deduplicate any existing duplicate pr_merged rows
-- (keeping the earliest) and enforce a partial unique index on
-- (repo, (payload->>'prNumber')) for event_type = 'pr_merged'.

DELETE FROM pipeline.audit_log a
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY repo, (payload->>'prNumber')
           ORDER BY created_at, id
         ) AS rank
    FROM pipeline.audit_log
   WHERE event_type = 'pr_merged'
     AND repo IS NOT NULL
     AND payload ? 'prNumber'
) dup
WHERE a.id = dup.id
  AND dup.rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS audit_log_pr_merged_uniq
  ON pipeline.audit_log (repo, (payload->>'prNumber'))
  WHERE event_type = 'pr_merged'
    AND repo IS NOT NULL
    AND payload ? 'prNumber';
