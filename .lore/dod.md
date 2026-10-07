# Definition of Done

> Stored `config->'pod_resources'` afterwards was `{"requests": {"ephemeral-storage": "4Gi"}}`. The 4Gi memory limit was gone, so the next fix-ci pod would have fallen back to the 1Gi default.

**Strategy: `direct`** — The seam exists: `agents-route.test.ts` already drives the PUT handler through a real server with a `fakeAgents` mock. Adding a test case where the resolved definition carries full `pod_resources` and the PUT sends a partial patch exercises the exact code path that `resolvePodResourcesUpdate` in `agent-common.ts` owns.

## Done when these pass

- [x] **a partial PUT for pod_resources merges per sub-key, not replaces the whole block** — PUT with `{ requests: { "ephemeral-storage": "4Gi" } }` when the existing definition already has `limits.memory`, `limits.ephemeral-storage`, and `requests.memory` stored must result in `fakeAgents.update` receiving a `podResources` that contains all four values, not just the one named in the patch.
  `apps/lore-api/src/transport/routes/agent-definitions/agents-route.test.ts`

## Facets

- [x] In `resolvePodResourcesUpdate` (`agent-common.ts`): read the existing `pod_resources` from the resolved definition's config and deep-merge the incoming patch into it at the `requests`/`limits` sub-key level before setting `podResources` in the returned `PodResourcesWrite`.
- [x] The merge must be additive: a key named in the patch overwrites, a key absent from the patch is preserved from the stored value.
- [x] An explicit `null` patch must still clear the override (existing behaviour, unchanged).

## Out of scope

- The GKE Autopilot ephemeral-storage limit note (lifting `requests` to match `limits` in the API or UI form) — the ticket names it as "also worth knowing", not a requirement for this fix.
- The org-default update path (`updateOrgDefinition` / `UPDATE_ORG_DEF_SQL`) — the ticket's reproduction uses a per-repo PUT; the same fix may propagate there but is not the stated claim.
