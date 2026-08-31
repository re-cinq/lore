# Definition of Done

Strategy: direct

Why: `pruneOnce` in `apps/cluster-agent/src/reap/prune-loop.ts` already has an injectable `PruneCluster` seam. The acceptance test calls the real `pruneOnce` with a fake cluster that includes a `deleteSecretKey` spy, and asserts the spy is invoked. TypeScript's structural subtyping allows passing a cluster with more methods than `PruneCluster` declares.

Acceptance tests:
  - apps/cluster-agent/src/reap/prune-loop.test.ts::pruneOnce > deletes the per-task token key from agent-secrets when pruning an orphaned definition — when `pruneOnce` prunes a `pt-XXXX` definition it must also call `deleteSecretKey("GH_TOKEN_XXXX")` so the token does not accumulate in agent-secrets on a satellite

Facets (the red-green-refactor steps you expect, smallest first):
  - Add `deleteSecretKey(key: string): Promise<void>` to the `PruneCluster` interface in `prune-loop.ts`
  - In `pruneOnce`, after deleting each definition whose name starts with `pt-`, derive the corresponding key (`"GH_TOKEN_" + name.slice(3)`) and call `cluster.deleteSecretKey(key)` — skipping on failure, the same way `deleteEach` skips a wedged object
  - Wire `KubeSecretKeyWriter.deleteKey` into the real `PruneCluster` adapter in `start-prune-loop.ts` so the live path reaches agent-secrets

Out of scope:
  - Central cluster: the Floor already calls `DELETE /api/cluster/per-task-tokens/{taskId}` on the central cluster-agent; this ticket is only about the satellite path where that call never arrives
  - Backfill of keys that accumulated before this fix ships
  - Changing `decide-prune.ts` / `PrunePlan` — the fix lives in `pruneOnce`'s execution, not in the pure plan
