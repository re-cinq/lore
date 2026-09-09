-- Reclassify already-ingested test files from `code` to `test` in every chunk
-- schema. The classifier (libs/shared/src/domain/content-classify.ts) stamps
-- new ingests; rows from before the type existed stay `code` until this runs,
-- and the assembled bundle's code source would keep returning them for
-- questions about the source they exercise.
--
-- The path grammar mirrors isTestFile (libs/shared/src/domain/test-paths.ts)
-- for the extensions the classifier calls code.
--
-- Same all-schemas loop as 0011/0034: pg_catalog discovery, a subtransaction per
-- schema, insufficient_privilege caught because the `lore` runner does not own
-- every team schema. Idempotent: a re-run matches no `code` row that is a test path.
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
      EXECUTE format($f$
        UPDATE %I.chunks
           SET content_type = 'test'
         WHERE content_type = 'code'
           AND (file_path ~ '\.(test|spec)\.'
                OR file_path ~ '_test\.'
                OR file_path ~ '(^|/)__tests__/'
                OR file_path ~ '(^|/)test_[^/]*\.py$'
                OR file_path ~ 'Tests?\.(java|kt|cs)$'
                OR file_path ~ '_spec\.rb$'
                OR file_path ~ 'Test\.php$')
      $f$, s);
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'skip %.chunks (insufficient privilege for runner)', s;
    END;
  END LOOP;
END $$;
