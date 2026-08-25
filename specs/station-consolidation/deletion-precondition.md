## Deletion precondition — gate / github_action

Run 2026-08-24 against production (`lore-db-1`, GKE) and locally.

A stored run graph is NOT re-validated against the NodeType enum when it is
read, so an in-flight run whose clone names a deleted type survives the deletion
and dies at dispatch with nothing to explain it. This is the check that says no
such run exists.

**The first version of this query was vacuous and said so only when controlled.**
It matched `'%"type":"gate"%'`, and the stored JSON is `{"type": "agent"}` — with
a space. It returned zero because it matched *nothing*, including types every
blueprint uses. Use JSONB containment, which does not care about formatting, and
always run the control.

```sql
-- CONTROL: retrospective is in every blueprint, so this MUST be non-zero.
-- If it is zero the query is broken, not the data clean.
SELECT count(*) FROM pipeline.assembly_runs
 WHERE graph->'nodes' @> '[{"type":"retrospective"}]'::jsonb;

-- THE CHECK: any run, any status, naming a type about to be deleted.
SELECT count(*) FROM pipeline.assembly_runs
 WHERE graph->'nodes' @> '[{"type":"gate"}]'::jsonb
    OR graph->'nodes' @> '[{"type":"github_action"}]'::jsonb;
```

| | production | local |
|---|---|---|
| control (`retrospective`) | 4936 | 165 |
| `gate` / `github_action`, ever | **0** | **0** |
| non-terminal only | **0** | **0** |
| `station_runs` for either node id | **0** | **0** |

Production carried 13,164 runs (13,032 finished, 129 failed, 3 running). Neither
type has ever appeared in a stored graph.

Leftover: `lore.agent_definitions` still holds a `def-gate` row (no
`def-github-action`). Nothing dispatches to it and the catalog seed no longer
generates it; prunable, not blocking.
