-- 0034_backfill_chunk_ingested_by: stamp `ingested_by = 'reindex-job'` on
-- legacy chunk rows the reindex job wrote before ingest provenance existed.
--
-- The stale-chunk fix (issue #967) restricts gap-detect's staleChunkCount and
-- the nightly reindex verification pass (re-stamp / prune) to rows with
-- metadata->>'ingested_by' = 'reindex-job'. Rows ingested before that marker
-- was stamped have no ingested_by at all, so without a backfill they would be
-- invisible to both the count and the verification pass until their file next
-- changes. Only rows whose file_path falls inside the reindex SEED scope
-- (CLAUDE.md / AGENTS.md exact, adrs/ specs/ .specify/ prefixes) are stamped.
-- That is deliberately narrower than everything reindex ever wrote: the
-- incremental path ingests any classifiable changed file (code, runbooks/,
-- other .md/.yaml), so legacy rows outside seed scope stay unstamped and
-- remain invisible to the stale count and the verification pass. Widening the
-- filter is not safe — provenance-less rows outside seed scope include
-- non-reindex writers (e.g. the UI's tasks/ui-created chunks), and adopting
-- one of those marks it for pruning since its "file" is not in the repo tree.
-- API- and UI-ingested rows keep their existing provenance because the filter
-- also requires ingested_by to be absent.
--
-- Same all-schemas loop as 0011: pg_catalog discovery (privilege-filtered
-- information_schema would hide schemas), per-schema subtransaction, and
-- insufficient_privilege caught per schema because the 'lore' runner does not
-- own the per-team schemas. Idempotent: stamped rows no longer match the
-- ingested_by-absent filter on re-run.

DO $$
DECLARE
  s TEXT;
BEGIN
  FOR s IN
    SELECT n.nspname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chunks' AND c.relkind = 'r'
  LOOP
    BEGIN
      EXECUTE format($q$
        UPDATE %I.chunks
        SET metadata = coalesce(metadata, '{}'::jsonb)
          || '{"ingested_by": "reindex-job"}'::jsonb
        WHERE metadata->>'ingested_by' IS NULL
          AND (file_path IN ('CLAUDE.md', 'AGENTS.md')
               OR file_path LIKE 'adrs/%%'
               OR file_path LIKE 'specs/%%'
               OR file_path LIKE '.specify/%%')
      $q$, s);
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'skip %.chunks (insufficient privilege for runner)', s;
    END;
  END LOOP;
END$$;
