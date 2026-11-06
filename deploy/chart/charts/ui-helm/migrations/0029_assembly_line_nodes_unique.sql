-- Event-driven walk (spec 6-dark-factory FR6): (line, node, iteration) is launched
-- at most once — the UNIQUE index is the structural convergence point for duplicate
-- or concurrent transition handlers (ensureNodeStart's ON CONFLICT upsert).
--
-- B1->B2 window note: until PR-B2 swaps the still-live recordNodeStart plain INSERT
-- (floor-assembly-line-run.ts / run-detect.ts) for ensureNodeStart, that INSERT can
-- hit 23505 once this index lands, in exactly the scenarios that produced the
-- historical duplicates deleted below (a retried assembly_line.start re-walking a
-- line, or crash-resume re-executing a node). traceNodeStart catches it, so the walk
-- survives, but that node's row + finish/commit-sha are lost until B2 merges.
--
-- One-time cleanup first: keep the lowest-id row of any historical duplicates.
DELETE FROM pipeline.assembly_line_nodes a
 USING pipeline.assembly_line_nodes b
 WHERE a.assembly_line_id = b.assembly_line_id
   AND a.node_id = b.node_id
   AND a.iteration = b.iteration
   AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS assembly_line_nodes_attempt_uniq
  ON pipeline.assembly_line_nodes (assembly_line_id, node_id, iteration);
