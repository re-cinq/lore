-- 0011_purge_misclassified_spec_chunks: delete source files that were
-- ingested with content_type = 'spec' by mistake.
--
-- classifyFile() used to match ANY path containing a `specs/` segment and ran
-- BEFORE the code-extension check, so source files under a nested directory
-- named specs/ (e.g. web-ui/src/app/specs/page.tsx, .../specs/SpecDetails.tsx)
-- were stored as content_type='spec' and showed up as cards on the specs page.
-- The classifier now resolves source extensions to 'code' first
-- (shared/src/content-classify.ts), but the bad rows already in the DB persist
-- until a re-ingest — which never happens for unchanged files. This removes
-- them directly.
--
-- Targets only rows whose file_path has a source-code extension, matching the
-- extensions the corrected classifier now returns 'code' for. Real markdown /
-- yaml specs are untouched.
--
-- Discovered via pg_catalog (privilege-filtered information_schema would hide
-- schemas). Runner is 'lore', which owns its own schemas but NOT the per-team
-- schemas (e.g. payments) — those are owned by their team roles. Skip any
-- chunks table the runner cannot DELETE from rather than aborting the whole
-- migration (and with it the pre-upgrade hook and the UI rollout). The
-- web-ui filters spec rows by `.md` extension at query time, so residual
-- mis-classified rows in unowned schemas stay hidden there regardless.
-- Idempotent: safe to re-run.

DO $$
DECLARE
  s TEXT;
BEGIN
  FOR s IN
    SELECT n.nspname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chunks' AND c.relkind = 'r'
      AND has_table_privilege(current_user, format('%I.chunks', n.nspname), 'DELETE')
  LOOP
    EXECUTE format($q$
      DELETE FROM %I.chunks
      WHERE content_type = 'spec'
        AND file_path ~ '\.(ts|tsx|js|jsx|mjs|cjs|py|go|sh|rs|java|rb|kt|c|cpp|h|hpp)$'
    $q$, s);
  END LOOP;
END$$;
