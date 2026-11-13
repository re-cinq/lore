-- 0035_migrate_legacy_org_shared_chunks: MOVE legacy chunk rows from
-- org_shared.chunks into each repo's resolved team schema (issue #979).
--
-- Repos ingested before their team schema existed left rows in
-- org_shared.chunks. Reindex and all post-#975 reads resolve the team schema
-- (lore.repos.team), so those legacy rows are invisible to staleChunkCount and
-- the nightly verification sweep — never re-stamped, never pruned. Seed-scope
-- files (CLAUDE.md, AGENTS.md, adrs/, specs/, .specify/) exist TWICE (fresh in
-- the team schema, stale in org_shared); rows outside seed scope exist ONLY in
-- org_shared and are unreachable dead weight.
--
-- MOVE, not delete, with per-FILE dedupe: a file already present in the target
-- schema (any row with the same repo + file_path) keeps its fresh copy and the
-- stale org_shared rows for it are simply dropped; files absent from the
-- target have all their chunk rows relocated wholesale. The move preserves row
-- ids, 768-dim embeddings (re-embedding costs money and reindex would NOT
-- regenerate them for unchanged files), ingested_at, and metadata, rewrites
-- the team column to the resolved team, and stamps
-- metadata->>'migrated_from' = 'org_shared' for auditability. search_tsv is
-- GENERATED ALWAYS and must be omitted from the INSERT column list.
--
-- Copy and delete run as data-modifying CTEs of ONE statement, so they share
-- one snapshot and abort together: a row committed into org_shared by a
-- concurrent writer (the Helm hook is pre-upgrade — old Floor pods still run,
-- and reindex falls back to org_shared on transient resolve errors) is
-- invisible to both and survives untouched, and the delete only ever removes
-- rows that were copied here (moved) or whose file already lives in the
-- target (stale duplicates, matched by file_path or by id for rows a prior
-- run already copied). Never a delete without a copy.
--
-- Relocated rows whose content_type is one classifyFile() can return
-- ('doc', 'code', 'adr', 'spec' — shared/src/content-classify.ts) and that
-- lack ingest provenance are adopted by the verification sweep via
-- ingested_by = 'reindex-job'. This deliberately narrows ADR-019's accepted
-- gap 1 (pre-provenance rows outside seed scope) without blanket-adopting
-- pseudo-path writers (rule, pull_request, tasks/ui-created) whose "files" are
-- not in the repo tree — adopting those would mark them for pruning. Gap 2
-- (api-owned orphans of deleted files) is not closable in SQL — it needs a
-- GitHub tree read and belongs in reindex verify.ts as a follow-up.
--
-- The runner is 'lore', which does not own the chunk tables (0011/0034
-- pattern): insufficient_privilege is caught per repo and skipped with a
-- NOTICE, and the per-repo subtransaction rolls the statement back whole. The
-- operator must check the deploy log for skips, apply the grant documented in
-- migrations/README.md, and re-run the file by hand. Idempotent: a second run
-- finds no org_shared rows for migrated repos; ON CONFLICT (id) DO NOTHING
-- plus the per-file NOT EXISTS guard cover partial re-runs.
--
-- Loops over repos (lore.repos), not schemas: only teams that pass the
-- schema-name check and have a real chunks table (pg_catalog, because
-- privilege-filtered information_schema would hide it) are targets. Repos
-- whose team IS org_shared already live in their resolved schema.

DO $$
DECLARE
  r RECORD;
  moved BIGINT;
  dropped BIGINT;
BEGIN
  FOR r IN
    SELECT rep.full_name, rep.team
    FROM lore.repos rep
    JOIN pg_catalog.pg_namespace n ON n.nspname = rep.team
    JOIN pg_catalog.pg_class c
      ON c.relnamespace = n.oid AND c.relname = 'chunks' AND c.relkind = 'r'
    WHERE rep.team ~ '^[a-z][a-z0-9_]{0,62}$'
      AND rep.team <> 'org_shared'
  LOOP
    BEGIN
      EXECUTE format($q$
        WITH moved AS (
          INSERT INTO %I.chunks
            (id, content, embedding, content_type, team, repo, file_path,
             author, ingested_at, metadata)
          SELECT o.id, o.content, o.embedding, o.content_type, %L, o.repo,
            o.file_path, o.author, o.ingested_at,
            coalesce(o.metadata, '{}'::jsonb)
              || jsonb_build_object('migrated_from', 'org_shared')
              || CASE
                   WHEN o.metadata->>'ingested_by' IS NULL
                     AND o.content_type IN ('doc', 'code', 'adr', 'spec')
                   THEN '{"ingested_by": "reindex-job"}'::jsonb
                   ELSE '{}'::jsonb
                 END
          FROM org_shared.chunks o
          WHERE o.repo = %L
            AND NOT EXISTS (
              SELECT 1 FROM %I.chunks t
              WHERE t.repo = o.repo AND t.file_path = o.file_path
            )
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        ),
        dropped AS (
          DELETE FROM org_shared.chunks o
          WHERE o.repo = %L
            AND (o.id IN (SELECT id FROM moved)
                 OR EXISTS (
                   SELECT 1 FROM %I.chunks t
                   WHERE t.repo = o.repo
                     AND (t.file_path = o.file_path OR t.id = o.id)
                 ))
          RETURNING id
        )
        SELECT (SELECT count(*) FROM moved), (SELECT count(*) FROM dropped)
      $q$, r.team, r.team, r.full_name, r.team, r.full_name, r.team)
      INTO moved, dropped;

      IF moved > 0 OR dropped > 0 THEN
        RAISE NOTICE 'org_shared -> %.chunks: repo % moved % of % legacy rows (rest were stale duplicates of files already in the target)',
          r.team, r.full_name, moved, dropped;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'skip repo % -> %.chunks (insufficient privilege for runner — grant per migrations/README.md and re-run)',
          r.full_name, r.team;
    END;
  END LOOP;
END$$;
