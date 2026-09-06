---
adr_number: 36
title: "Declared module import boundaries"
status: in progress
date: 2026-07-15
domains: [architecture, modules, ci, dx]
---

# ADR-036: Declared module import boundaries

The layering is written down. `layers.yaml` at the repo root maps each folder to the folders it may import, and `lore/no-cross-layer-import` checks every import against it, so the architecture is a file a person can read and disagree with rather than a shape inferred by tracing imports.

## Context

As the codebase grew into deployables sharing a light core (ADR-032), layering
regressions became easy to introduce: an app reaching into another app's
internals, a shared lib importing an app, or a presentational layer importing
the data layer. These couplings erode the deployable boundaries and make the
light `@re-cinq/lore-shared` install fat.

Worse, the layering existed only in people's heads and in prose. A reviewer
could not check an import against anything; they had to already know the
intended shape. Where it was enforced at all, it was enforced by a hand-written
test suite for a single package, so a boundary cost a tree walk and an import
regex to add, and every package that had not had a suite written for it had no
boundaries at all.

## Decision

Import boundaries are **declared**, not conventional and not asserted in
procedural test code. `layers.yaml` at the repo root maps each package's folders
to the folders they may import; `lore/no-cross-layer-import` reports an import
the declaration does not permit.

```yaml
layers:
  apps/floor:
    ".":       [delivery, jobs, kernel, listeners, main-loop, "@re-cinq/lore-shared"]
    kernel:    ["@re-cinq/lore-shared"]
    jobs/lib:  [kernel, "@re-cinq/lore-shared"]
    jobs/*:    [jobs/lib, kernel, "@re-cinq/lore-shared"]
```

Four rules govern the file, and no others:

1. A key names a **layer** — the folder it names and everything under it. `*`
   matches one segment, so `jobs/*` makes each domain its own layer.
2. Movement **inside** a layer is free. The list governs only what leaves it.
3. A layer may import what its list names, and nothing else.
4. The most specific matching key wins, so `jobs/lib` beats `jobs/*`.

Sibling isolation needs no syntax and no second direction. `jobs/*` makes each
domain a layer that lists `jobs/lib`, so `jobs/review` reaches lib and itself
while `jobs/merge` is simply absent from the list. `delivery/` stays reachable
only from the root entry for the same reason: nothing else lists it.

A package **absent** from the file is unchecked, so packages join one at a time
rather than the whole repo having to be described before anything is enforced.
Inside a package that is present, a folder with **no** entry may import nothing.
That asymmetry is deliberate: adoption is incremental, but within an adopted
package a new folder cannot quietly escape the declaration.

`node:` and npm specifiers are never governed — `package.json` owns those.
Cross-package `@re-cinq/*` specifiers are, written verbatim in a list.

## Consequences

The layering is self-documenting: a violating import is reported at the import,
against a file stating what the architecture is meant to be. A reviewer can
read `layers.yaml` and argue with it, which was not possible when the shape
lived in prose or in a test's control flow.

The declaration must state **intent**, not the imports that exist. Generating it
from the current import graph would make the rule green on the day it lands and
enforce nothing — it would freeze whatever coupling the code had accumulated and
call it architecture. The gap between the declared layering and the actual one
is the point, and it is a queue of refactors.

That gives the file exactly one failure mode: widening an entry to make a
finding go away. It is quieter than editing a test, because a list gaining an
item looks like configuration rather than a decision. The first time an entry is
widened to silence a finding rather than to record a boundary that was wrong,
the file has started describing the code instead of governing it.

This replaces `apps/floor/src/domain-boundaries.test.ts`, whose four Floor
boundaries — no dissolved horizontal layer, `kernel/` a leaf, `delivery/`
reachable only from the root entry, `jobs/lib/` a leaf — are now entries in
`layers.yaml`. Each was a bespoke tree walk over the same file list; all four
are now consequences of the four rules above.

## Amended 2026-09-06: horizontal tiers, reinstated deliberately

The original decision recorded here dissolved the horizontal layers
(`adapters`/`application`/`data`/`ports`) in favour of vertical domains, and the
rule enforced that by listing none of them. That is reversed: the source is
organised top-down as **`app` → `http` → `jobs` → `storage`**, and `storage` is
the bottom tier every other tier may reach and which reaches nothing above it.

`storage`, `http` and `jobs` are the dissolved `data`, `adapters` and
`application` under clearer names. Recording that plainly matters more than the
names: this reinstates a shape the repo removed once, so the reasoning has to be
written down rather than rediscovered.

**What the vertical arrangement was giving up.** Nothing — that was the
problem. Measured across `apps/floor/src/jobs`, thirteen of fifteen domains had
zero or one edge to a sibling. The vertical split was not holding coupling
apart, because there was almost none to hold: the domains were already
independent, and the arrangement mostly meant that finding the code for one job
required knowing which of fifteen folders someone had filed it under. The two
genuine cross-domain edges that remained (`task → dark-factory`,
`watcher → merge`) were a policy lookup and a lifecycle trigger, not domain
coupling.

**What it is costing.** A feature spans three folders again — an ingress, a job,
and a query — which is the trade the original dissolution refused. The
mitigation is the tier's own rule: `jobs/` holds **one folder per job**, so a
job stays a single unit inside its tier and only its ingress and its persistence
live elsewhere.

**What does not change.** Boundaries stay declared in `layers.yaml` and checked
by `lore/no-cross-layer-import`; the mechanism this ADR exists for is unaffected
by which shape it describes. The direction rule is unchanged too — a tier may
reach the tier below it and never the one above, so `storage` importing `jobs`
is exactly the substrate-imports-upward defect fixed in #1803 and #1807, under
new names.

## Tiers

| tier | holds | may import |
|---|---|---|
| `app` | the entry point, the composition root, the run loop | `http`, `jobs`, `storage` |
| `http` | ingress and egress: webhook routes, SSE, health, producers | `jobs`, `storage` |
| `jobs` | one folder per job — 29 of them in the Floor | `storage` |
| `storage` | pool, queues, ports, the event store | nothing above it |

## Validation

<!--
  Link the rule's cases inline (v3):
  `The rule <behaviour>. ([validated by `no-cross-layer-import.test.mjs:NN`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#LNN))`
-->

A folder with no entry in a governed package may import nothing, so a folder added without a declaration is reported rather than silently unconstrained. ([validated by `no-cross-layer-import.test.mjs:128`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L128))

A folder no entry lists can never resolve as an import target, whatever it is called — which is what keeps a retired tier retired, and equally what keeps a new one honest. ([validated by `no-cross-layer-import.test.mjs:100`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L100))

`kernel/` — the shared substrate — imports nothing outside itself, keeping it the bottom tier that everything imports and that imports nothing above it. ([validated by `no-cross-layer-import.test.mjs:107`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L107))

Only the root `index.ts` entry may import `delivery/`, keeping the entry-point tier (`dist/delivery/*` deploy contract) imported by nothing but the root entry — and it holds because no other entry lists it, not because a rule names it. ([validated by `no-cross-layer-import.test.mjs:135`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L135))

`jobs/lib/` imports only `kernel/` and shared, keeping the cross-cutting job-services leaf from reaching back into a sibling job domain. ([validated by `no-cross-layer-import.test.mjs:121`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L121))

Movement inside a layer is free, so a file may reach an ancestor or a descendant of its own folder without an entry naming it. ([validated by `no-cross-layer-import.test.mjs:86`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L86))

Where the substrate needs something only a job domain can build, the dependency is inverted rather than the boundary widened: `kernel/project-boot.ts` owns `projectFor` and the composition root injects the station backend, so `kernel` still imports nothing above it. Reaching either before the root has wired it names the composition root instead of failing obscurely, and a failed build is retried rather than cached. ([validated by `names the composition root when projectFor runs before anything wired it`](apps/floor/src/kernel/project-boot.test.ts#L17), [validated by `names the composition root when stationBackendNow runs before anything wired it`](apps/floor/src/kernel/project-boot.test.ts#L23), [validated by `hands back the backend the composition root registered`](apps/floor/src/kernel/project-boot.test.ts#L29), [validated by `retries the build after a rejection rather than caching the failure`](apps/floor/src/kernel/project-boot.test.ts#L35))

A package absent from `layers.yaml` is not checked at all, so the declaration is adopted one package at a time. ([validated by `no-cross-layer-import.test.mjs:62`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L62))
