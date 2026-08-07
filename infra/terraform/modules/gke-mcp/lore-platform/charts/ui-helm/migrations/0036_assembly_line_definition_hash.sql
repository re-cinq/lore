-- 0036_assembly_line_definition_hash: store the content hash of the loaded
-- definition on each assembly-line execution (specs/fork-rerun-from-node).
--
-- The `resumeFrom` start variant copies a terminal line's node-row prefix and
-- replays live from there — legal only when the definition graph is the one
-- the source rows were walked under. The walk's start handler stamps the hash
-- once (recordDefinitionHash, only while NULL); resume_from compares it to the
-- current definition's hash and fails fast on drift. Rows predating this
-- column keep NULL and are rejected by resume_from with a clear message until
-- backfilled — an honest limitation, preferable to forking across silent
-- definition drift.
--
-- Idempotent: safe to re-run.

ALTER TABLE pipeline.assembly_lines ADD COLUMN IF NOT EXISTS definition_hash TEXT;
