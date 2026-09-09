# Definition of Done

> central is paused, and it is the **only** agent advertising
> `node:comment-triage` — or any of the seven non-agent tags. [...] Every PR
> comment right now produces a red `lore/comment-triage` check on the PR, ~30
> minutes after it is posted.

**Strategy: `changes_requested`** — the ticket is a diagnostic incident report.
Its reported problem is a production/operational state (`pipeline.cluster_agents.paused
= true` on `central`), which no acceptance test can flip. Its three "What to
decide" items resolve to: (1) unpause `central` — operational; (2) provision a
redundant cluster-agent advertising the non-agent tags — a deployment/registration
action against the live registry; (3) surface `paused` in the reaper's
queue-timeout detail — **already shipped and pinned green**. There is no new code
behaviour left that a red-then-green acceptance test could bind for this ticket's
stated reason.

## What is already done (item 3, the only code change the ticket names)

`assembly-run-reaper.ts`'s two queue-timeout arms already read the registry once
per sweep (`listClusterAgents`) and write the diagnosis via
`capacityFor()` + `unclaimedDetail()` in
`libs/shared/src/project/cluster-agents/capacity.ts`. When the sole provider is
paused the failure detail reads, verbatim:

    no cluster-agent claimed this run (required_tags: [node:validate]) within 30m
    — every cluster-agent offering [node:validate] is unavailable: central (paused)

which is exactly the "name the paused agent instead of blaming an absent one"
change the ticket asks for. Shipped in #1671 (`d0d71b09`), part of slice A of
`plans/implementation-loop-dispatch-tier.md`.

Pinned green by existing tests (all pass on this branch, verified this round):

- `libs/shared/src/project/cluster-agents/capacity.test.ts` — 14 passed,
  including "returns all-unavailable naming the paused agent that is the only
  provider" and "unclaimedDetail names the paused provider rather than reporting
  nobody registered".
- `apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts` — "names the
  paused cluster that could have claimed it, rather than blaming an absent one"
  and "the implementation line's unclaimed validate node → fails the run once and
  never re-dispatches implement" (the 2026-08-29 incident end to end on the real
  blueprint, central paused).

Also already shipped from the same plan: the `unclaimed` failure class
(`libs/shared/src/error-classify.ts`, in `PERMANENT`) makes the walk refuse the
retry, so a paused-sole-provider node fails the run **once** instead of burning a
second full implementation. That was the costly half of the incident and it is
closed.

## What is NOT expressible as an acceptance test (and would need a human)

- **Unpause `central`** (decision 1): a row edit in `pipeline.cluster_agents`
  or a `POST /api/cluster-agents/{id}/pause` operator action. Not code on this
  branch; nothing to make go red→green.
- **A second agent advertising the seven non-agent tags** (decision 2): a
  cluster-agent registration with those tags in the live fleet (a deployment,
  or a satellite operator switching one on). The tag→agent mapping is runtime
  registry data, not a source-code seam. The *code* that would let redundancy
  help — the capability/claim gate and the `unclaimed` no-retry class — already
  exists (`capacityFor`, the claim gate acceptance tests in #1648, the reaper
  `unclaimed` arm).

To turn any of decisions 1–2 into a mergeable code change a human must first
choose the policy: e.g. "the Floor should refuse to arm a node when
`capacityFor` returns `all-unavailable`/`registry-empty` and re-drive instead of
queue-timing-out" would be a *new* behavioural spec statement (a capability gate
in `advanceLine`), not this ticket — that is a separate ticket against
`plans/implementation-loop-dispatch-tier.md`, and its diagnostic substrate is
already built.

## Out of scope

- The whole `plans/implementation-loop-dispatch-tier.md` (slices B–F). This
  ticket is the narrow paused-central diagnostic report, not the dispatch-tier
  refactor.
- Any `| Status |` edits — nothing new was implemented this round.
