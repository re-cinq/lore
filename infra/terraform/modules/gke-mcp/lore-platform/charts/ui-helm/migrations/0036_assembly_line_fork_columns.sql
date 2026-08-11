-- 0036_assembly_line_fork_columns: the columns fork-and-rerun needs on
-- pipeline.assembly_lines (specs/fork-rerun-from-node FR4, FR5).
--
-- definition_hash — the content hash of the assembly-line definition this
-- execution ran, stamped once by the Floor's assembly_line.start handler at the
-- moment the definition resolves. `resumeFrom` copies a prior execution's node
-- rows and lets the ordinary walk replay them against the CURRENT graph, which
-- is sound only while the graph has not changed; the fork compares the caller's
-- current hash against this column and refuses a mismatch. Rows predating this
-- column carry NULL and are refused outright rather than forked across silent
-- drift — an honest limitation, not a bug. No backfill ships with this
-- migration: the hash of a historical run's definition is not recoverable from
-- the row, only from the commit that produced it.
--
-- resumed_from_line_id / resumed_from_node_id — the fork's parentage. The
-- assembly_line.start event carries the same pair, but pipeline.events rows are
-- pruned once handled, so the durable audit answer to "why does this line exist
-- and where did its inherited rows come from" has to live on the row. The Floor
-- also reads resumed_from_node_id to size the inherited prefix in the
-- branch-overlap guard, so a fork that lands on a busy branch still defers.
--
-- No FK on resumed_from_line_id: it is a provenance pointer, and losing the
-- source row (retention, manual cleanup) must not cascade into or block the
-- fork that outlived it.
--
-- Idempotent: every statement is IF NOT EXISTS — safe to re-run.

ALTER TABLE pipeline.assembly_lines
  ADD COLUMN IF NOT EXISTS definition_hash TEXT;

ALTER TABLE pipeline.assembly_lines
  ADD COLUMN IF NOT EXISTS resumed_from_line_id UUID;

ALTER TABLE pipeline.assembly_lines
  ADD COLUMN IF NOT EXISTS resumed_from_node_id TEXT;

ALTER TABLE pipeline.assembly_lines
  ADD COLUMN IF NOT EXISTS inherited_node_count INTEGER NOT NULL DEFAULT 0;

-- Answers "which forks descend from this line" without a full scan; partial so
-- the index costs nothing for the overwhelming majority of non-forked rows.
CREATE INDEX IF NOT EXISTS idx_assembly_lines_resumed_from
  ON pipeline.assembly_lines(resumed_from_line_id)
  WHERE resumed_from_line_id IS NOT NULL;
