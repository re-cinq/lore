# Definition of Done

> Every line whose agent node ran on a satellite leaks its key and catalog triple, permanently, in that satellite's cluster

**Strategy: `direct`** — `pruneOnce` in `apps/cluster-agent/src/reap/prune-loop.ts` already has an injectable `PruneCluster` seam; the acceptance test calls the real function with a fake cluster that adds a `deleteSecretKey` spy, and asserts the spy is invoked with `GH_TOKEN_<taskId>` when the corresponding `pt-<taskId>` definition is swept.

## Done when these pass

- [ ] **deletes the per-task token key from agent-secrets when pruning an orphaned definition** — when `pruneOnce` sweeps a `pt-XXXX` definition it must call `deleteSecretKey("GH_TOKEN_XXXX")` so the satellite does not accumulate the key indefinitely
  `apps/cluster-agent/src/work/reap/prune-loop.test.ts`

## Facets

- [x] Add `deleteSecretKey(key: string): Promise<void>` to the `PruneCluster` interface in `prune-loop.ts`
- [x] In `pruneOnce`, after deleting each definition whose name starts with `pt-`, derive the corresponding key (`"GH_TOKEN_" + name.slice(3)`) and call `cluster.deleteSecretKey(key)` — skipping on failure, the same way `deleteEach` skips a wedged object
- [x] Wire `KubeSecretKeyWriter.deleteKey` into the real `PruneCluster` adapter (`KubePruner`) so the live path reaches `agent-secrets` (wired via new constructor param with default `KubeSecretKeyWriter`; `start-prune-loop.ts` needs no change)

## Out of scope

- Central cluster: the Floor already calls `DELETE /api/cluster/per-task-tokens/{taskId}` on the central cluster-agent; this ticket is only about the satellite path where that call never arrives
- Backfill of keys that accumulated before this fix ships
- Changing `decide-prune.ts` / `PrunePlan` — the fix lives in `pruneOnce`'s execution, not in the pure plan
