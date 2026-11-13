-- Rebuild every chunk schema's search_tsv without the spec-test-coverage link
-- groups. The `([validated by …](path#L…), …; implemented by …)` parentheticals
-- that v3 appends to spec statements were indexed as content, so the chunks
-- with the longest link lists ("test", "lib", "src", "task" hundreds of times)
-- won the keyword leg for every question — the same three spec chunks headlined
-- every assembled bundle for the four weeks the vector leg was down (2026-09-09).
--
-- The pattern is SPEC_LINK_GROUP_SQL_PATTERN in
-- libs/shared/src/domain/spec-link-strip.ts; a test holds this file and both
-- baseline schema scripts to it verbatim. A generated column is rebuilt for
-- every row on ADD, so no re-ingest is needed for keyword ranking.
--
-- Idempotent: a schema whose search_tsv already strips links is skipped.
DO $$
DECLARE
  s TEXT;
  expr TEXT;
BEGIN
  FOR s IN
    SELECT table_schema FROM information_schema.tables
     WHERE table_name = 'chunks'
       AND table_schema NOT IN ('pg_catalog', 'information_schema')
  LOOP
    SELECT generation_expression INTO expr
      FROM information_schema.columns
     WHERE table_schema = s AND table_name = 'chunks' AND column_name = 'search_tsv';

    IF expr IS NOT NULL AND expr LIKE '%regexp_replace%' THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP INDEX IF EXISTS %I.%I', s, s || '_chunks_search_idx');
    EXECUTE format('ALTER TABLE %I.chunks DROP COLUMN IF EXISTS search_tsv', s);
    EXECUTE format($f$
      ALTER TABLE %I.chunks
        ADD COLUMN search_tsv TSVECTOR GENERATED ALWAYS AS (
          to_tsvector('english', regexp_replace(content,
            '\(\s*\[(validated|implemented) by [^]]*\]\([^)[:space:]]*\)(\s*(,|;\s*implemented by)\s*\[[^]]*\]\([^)[:space:]]*\))*\s*\)',
            ' ', 'g'))
        ) STORED
    $f$, s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.chunks USING GIN (search_tsv)',
                   s || '_chunks_search_idx', s);
  END LOOP;
END $$;
