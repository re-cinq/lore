-- Reclassify already-ingested test files from `code` to `test` in every chunk
-- schema. The classifier (libs/shared/src/domain/content-classify.ts) stamps
-- new ingests; rows from before the type existed stay `code` until this runs,
-- and the assembled bundle's code source would keep returning them for
-- questions about the source they exercise.
--
-- The path grammar mirrors isTestFile (libs/shared/src/domain/test-paths.ts)
-- for the extensions the classifier calls code.
--
-- Idempotent: a re-run matches no `code` row that is a test path.
DO $$
DECLARE
  s TEXT;
BEGIN
  FOR s IN
    SELECT table_schema FROM information_schema.tables
     WHERE table_name = 'chunks'
       AND table_schema NOT IN ('pg_catalog', 'information_schema')
  LOOP
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
  END LOOP;
END $$;
