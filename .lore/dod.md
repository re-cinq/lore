# Definition of Done

> `AgentDefsPort` bundles reads and writes, and two of its three adapters do not
> have a write surface. `agent-defs-http.ts` and `agent-defs-yaml.ts` each declare
> `create`, `update` and `delete` only to throw a shared `READ_ONLY` constant [...]
> Split the port into a read port and a write port, with only the Pg adapter
> implementing both. [...] The stubs and their duplication disappear, and the
> refusal becomes something the compiler enforces.

**Strategy: `direct`** — the adapters are constructable today, so their runtime
surface is testable through the real constructors. The ticket's true win is
type-level (a runner adapter cannot even name `update`), which vitest cannot
observe — it transpiles without checking types. But that type change has one
runtime consequence the runner CAN see: the throwing write stubs stop existing
on the read adapters. That is the honest red bar, and it forces the stubs to be
physically removed (not merely un-required by a narrower interface), which is
exactly what the ticket asks — "The stubs and their duplication disappear."

## Done when these pass

- [ ] **neither AgentDefsHttp nor AgentDefsYaml exposes create/update/delete** —
  constructing each read adapter and asserting `"create"`/`"update"`/`"delete"`
  are absent from it. Red today because both carry the throwing stubs.
  `libs/shared/src/outbound/project/agents/agent-defs-read-only.test.ts`

## Facets

- [ ] Split `AgentDefsPort` into a read port (`resolve`/`list`) and a write port
  (`create`/`update`/`delete`, with `PodResourcesWrite`); `PgAgentDefs`
  implements both.
- [ ] Drop `create`/`update`/`delete` (and the `READ_ONLY` constant) from
  `agent-defs-http.ts` and `agent-defs-yaml.ts` — they implement the read port
  only. The `no-duplicate-code` disables on those two files go with them.
- [ ] Rewire callers: read sites take the read port; the one write site
  (`apps/lore-api/.../agent-definitions/agent-writes.ts`, and the `AgentDefs`
  facade path it goes through) takes the write port. Delete the now-impossible
  runtime-refusal tests (`agent-defs-http.test.ts` "refuses writes from a
  runner", `agent-defs-yaml.test.ts` "refuses writes without a database") — the
  refusal they pinned is now a compile error, so FR5/FR6 re-point to the new
  surface test (links already added).

## Out of scope

- The compile-time guarantee itself (that a read-port holder cannot call a
  write). vitest cannot assert it; CI's `tsc` build is what proves it once
  callers are rewired.
- Any change to how definitions resolve or merge (project → org → yaml) or to
  the Pg write behaviour — the write path keeps working unchanged.
- Draining the wider `no-duplicate-code` queue (#1898) beyond this one pair.
