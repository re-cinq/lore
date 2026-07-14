-- Event-driven walk (spec 6-dark-factory FR6): (line, node, iteration) is launched
-- at most once — the UNIQUE index is the structural convergence point for duplicate
-- or concurrent transition handlers (ensureNodeStart's ON CONFLICT DO NOTHING).
-- One-time cleanup first: keep the lowest-id row of any historical duplicates.
DELETE FROM pipeline.assembly_line_nodes a
 USING pipeline.assembly_line_nodes b
 WHERE a.assembly_line_id = b.assembly_line_id
   AND a.node_id = b.node_id
   AND a.iteration = b.iteration
   AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS assembly_line_nodes_attempt_uniq
  ON pipeline.assembly_line_nodes (assembly_line_id, node_id, iteration);
