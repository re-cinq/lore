---
adr_number: 47
title: "Plans are hosted by lore-api through planning-station"
status: accepted
date: 2026-09-21
deciders: ["Bogdan Szabo"]
domains: [feature-planning, lore-api, web-ui, infrastructure]
---

# ADR-047: Plans are hosted by lore-api through planning-station

This ADR records why a feature is now planned in a collaborative plan document hosted inside lore-api by the [re-cinq/planning-station](https://github.com/re-cinq/planning-station) packages, how lore installs them, and what hosting a live document in lore-api costs.

## Context

Feature planning ([`specs/7-feature-planning`](../specs/7-feature-planning/spec.md)) was a wizard over `lore.features`: one person typed direction per section, the planning agent regenerated the whole gap analysis every round, and nobody else could work on the draft at the same time.

planning-station ships that drafting step as four packages. `planning-document` is the plan contract. `planning-yjs` bridges it to Yjs. `planning-editor` is a React editor with presence and per-section Refine. `planning-sync` is a server that hosts the live document behind one `PlanStore` port and one `CollabAuthenticator` port, and mounts on the host's own hapi server. The packages are not on a registry.

## Decision

- lore-api hosts plans: it registers `@re-cinq/planning-sync` on its own hapi server, so `/api/plans/*` and the collaboration socket at `/api/plans/collab` share lore-api's process, port and ingress ([validated by](../apps/lore-api/src/integration-tests/plan-routes.test.ts#L65)).
- Plans are stored in `lore.plans`, `lore.plan_state` and `lore.plan_versions` by lore-api's `pgPlanStore`, which must pass planning-sync's own `checkPlanStore` ([validated by](../apps/lore-api/src/integration-tests/plan-store.test.ts#L24)).
- The library's routes carry no auth of their own, so lore-api holds every `/api/plans` call to its bearer tokens: any valid token reads, and a write needs `write` ([validated by](../apps/lore-api/src/integration-tests/plan-routes.test.ts#L57), [validated by](../apps/lore-api/src/integration-tests/plan-routes.test.ts#L61)).
- A browser opens the socket with an opaque collab token. lore-api mints it at the web tier's request, after the web tier has checked the person's session and repo access. Only its sha256 is stored, bound to one plan of one repo, and it expires after ten minutes. No signing secret is shared between web-ui and lore-api ([validated by](../apps/lore-api/src/integration-tests/plan-collab-tokens.test.ts#L45), [validated by](../apps/lore-api/src/integration-tests/plan-collab-tokens.test.ts#L81)).

## Consequences

- **lore-api runs one replica while plans are live in it.** Hocuspocus keeps each open document in the memory of the process whose socket it arrived on. Two people routed to different replicas would each edit their own copy until the next store. A second replica needs sticky routing by document name, or a shared Hocuspocus backplane, first.
- The lore-api ingress holds idle connections for an hour (`proxy-read-timeout`), because a plan page keeps its socket open while someone reads.
- A rollout waits up to 45 s (`terminationGracePeriodSeconds`), so planning-sync's `onPreStop` can store debounced keystrokes before the pod goes.
- Lore installs the packages as git dependencies on built-artifact tags (`<package>-dist-v<version>`, made by planning-station's `dist-tags` workflow). planning-station is a public repository, so CI and image builds need no credentials to fetch them.
- A new planning-station release reaches lore by bumping the tag in `package.json`. npm records the dependency as `git+ssh://` in the lockfile either way; a public repo installs anyway through GitHub's tarball endpoint.
