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

## Validation

<!--
  Link the rule's cases inline (v3):
  `The rule <behaviour>. ([validated by `no-cross-layer-import.test.mjs:NN`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#LNN))`
-->

A folder with no entry in a governed package may import nothing, so a folder added without a declaration is reported rather than silently unconstrained. ([validated by `no-cross-layer-import.test.mjs:128`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L128))

A dissolved horizontal layer (`adapters`/`application`/`data`/`ports`) can never resolve as an import target again, because nothing lists it and an unlisted target is denied. ([validated by `no-cross-layer-import.test.mjs:100`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L100))

`kernel/` — the shared substrate — imports nothing outside itself, keeping it the bottom tier that everything imports and that imports nothing above it. ([validated by `no-cross-layer-import.test.mjs:107`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L107))

Only the root `index.ts` entry may import `delivery/`, keeping the entry-point tier (`dist/delivery/*` deploy contract) imported by nothing but the root entry — and it holds because no other entry lists it, not because a rule names it. ([validated by `no-cross-layer-import.test.mjs:135`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L135))

`jobs/lib/` imports only `kernel/` and shared, keeping the cross-cutting job-services leaf from reaching back into a sibling job domain. ([validated by `no-cross-layer-import.test.mjs:121`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L121))

Movement inside a layer is free, so a file may reach an ancestor or a descendant of its own folder without an entry naming it. ([validated by `no-cross-layer-import.test.mjs:86`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L86))

A package absent from `layers.yaml` is not checked at all, so the declaration is adopted one package at a time. ([validated by `no-cross-layer-import.test.mjs:62`](tools/eslint-plugin-lore/rules/no-cross-layer-import.test.mjs#L62))
