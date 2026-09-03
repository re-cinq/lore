---
adr_number: 36
title: "Enforced module import boundaries"
status: in progress
date: 2026-07-15
domains: [architecture, modules, testing, ci, dx]
---

# ADR-036: Enforced module import boundaries

This ADR enforces architectural module import boundaries with a domain-boundaries test suite that asserts the allowed import directions between packages and layers, failing CI when a disallowed edge appears so the layering becomes a checked build invariant.

## Context

As the codebase grew into deployables sharing a light core (ADR-032), layering
regressions became easy to introduce: an app reaching into another app's
internals, a shared lib importing an app, or a presentational layer importing the
data layer. These couplings erode the deployable boundaries and make the light
`@re-cinq/lore-shared` install fat.

## Decision

Architectural import boundaries are enforced by tests, not convention: a
`domain-boundaries` test suite asserts the allowed import directions (which
package/layer may import which), failing CI when a disallowed edge appears. The
boundaries are a checked invariant of the build.

## Consequences

The layering is self-documenting and regression-proof; a violating import fails a
test rather than silently shipping.

## Validation

<!--
  Link the domain-boundary guard tests inline (v3):
  `The suite asserts <boundary>. ([validated by `domain-boundaries.test.ts:NN`](apps/floor/src/domain-boundaries.test.ts#LNN))`
-->

The guard suite discovers the Floor source tree before checking any edge, asserting there is at least one file to scan so an empty walk cannot pass the boundary checks vacuously. ([validated by `domain-boundaries.test.ts:85`](apps/floor/src/domain-boundaries.test.ts#L85))

The suite forbids any Floor file from importing into a dissolved horizontal layer (`adapters`/`application`/`data`/`ports`), so those retired layers can never resolve as an import target again. ([validated by `domain-boundaries.test.ts:89`](apps/floor/src/domain-boundaries.test.ts#L89))

The suite forbids `kernel/` — the shared substrate — from importing anything outside `kernel/`, keeping it the bottom tier that everything imports and that imports nothing above it. ([validated by `domain-boundaries.test.ts:101`](apps/floor/src/domain-boundaries.test.ts#L101))

The suite forbids any file other than the root `index.ts` entry from importing `delivery/`, keeping the entry-point tier (`dist/delivery/*` deploy contract) imported by nothing but the root entry. ([validated by `domain-boundaries.test.ts:116`](apps/floor/src/domain-boundaries.test.ts#L116))

The suite forbids `jobs/lib/` from importing anything but `kernel/` and shared, keeping the cross-cutting job-services leaf from reaching back into a sibling job domain. ([validated by `domain-boundaries.test.ts:139`](apps/floor/src/domain-boundaries.test.ts#L139))
