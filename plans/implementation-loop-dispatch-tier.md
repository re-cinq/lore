# Plan: Implementation-loop dispatch tier — park on missing capacity, never retry an unclaimed node

**Branch**: one branch per slice, all off `main` (`fix/unclaimed-failure-class`, `fix/claim-paused-signal`, `test/dispatch-tier-harness`, `feat/capacity-gate`, `feat/run-page-claim-columns`, `feat/single-cr-capacity-gate`)
**Status**: Active
**Plan file**: on approval copy this to `plans/implementation-loop-dispatch-tier.md` in the repo (planning-skill convention); delete it when slice F merges.

## Context

Every implementation-loop run since 2026-08-28 15:37 died the same way (tasks `7db1eb04`, `daee5447`, `cea7a47c`, `9ae6d656`, `4bf8537a` → issues #1629 #1634 #1647 #1648 #1650, all now `lore:blocked`):

```
implement ✓ (satellite, ~25m Sonnet) → validate queued 30m, nobody claims it
→ reaper fails it failureClass:"infra" → infra is retryable → validate->implement back-edge
→ implement #2 (~30m, prompted with "the pod died rather than the work failing" as its incoming failure)
→ validate queued 30m again → iteration_max → task failed → driver labels the ticket, re-arms, next ticket dies too
```

Root cause: `pipeline.cluster_agents.paused = true` on `central`, the only agent offering `node:validate` (the minikube satellite offers `node:agent` only). Verified live 2026-08-29 via `GET /api/cluster-agents`. Four design defects turn one flag into a backlog-wide, ~2h-and-two-implementations-per-ticket failure:

1. A queue-timeout is stamped `infra` (reaper [:486](apps/floor/src/jobs/assembly-run/assembly-run-reaper.ts#L486) graph arm, [:269](apps/floor/src/jobs/assembly-run/assembly-run-reaper.ts#L269) single-CR arm); `infra` is not in `PERMANENT` ([error-classify.ts:135](libs/shared/src/error-classify.ts#L135)), so [transition.ts:147](libs/assembly-lines/src/transition.ts#L147) spends a budgeted back-edge on it.
2. Nothing checks, before minting a row, that any active unpaused agent offers the node's tags — [advance-line.ts:50](apps/floor/src/jobs/assembly-run/advance-line.ts#L50) gates only on `llmGate`, and [launch-node.ts:44](apps/floor/src/jobs/assembly-run/launch-node.ts#L44) resolves the tags without asking who can serve them.
3. A paused agent gets a `204` identical to "idle" ([claim.ts:63](apps/lore-api/src/api/routes/cluster-agents/claim.ts#L63)); the claim loop's `ClaimOutcome` has no `paused` kind and never logs `empty` (issue #1654).
4. `GET /api/assembly-runs/{id}/nodes` projects nine fields and drops `status`, `required_tags`, `cluster_agent_id`, `claimed_at`, `failure_class` ([assembly-lines.ts:342](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.ts#L342)), so the run page cannot show any of this.

**Verified against `main` @ `156e6e3d` (2026-08-30)**, after PRs #1651, #1652, #1658–#1670 merged. Every premise above still holds on current main: no merged work introduces a capacity check, an `unclaimed` class, a paused signal, a `parked_reason`, or the extra `/nodes` fields; the acceptance harness still fakes the claim ([line-acceptance-harness.ts:182](apps/floor/src/jobs/assembly-run/line-acceptance-harness.ts#L182)); the reaper still reads `Date.now()`/`stationQueueWaitMs()` internally ([:218](apps/floor/src/jobs/assembly-run/assembly-run-reaper.ts#L218)); no open PR overlaps. What the merges DID change and this plan depends on: #1651 put single-CR launches on the claim queue (so slice F is a gate addition, not a transport change — and issue #1625 is already satisfied), and #1663 added `releaseClaim` + `ClaimOutcome` shapes that slice D extends rather than invents.

Tests were green because [line-acceptance-harness.ts:174](apps/floor/src/jobs/assembly-run/line-acceptance-harness.ts#L174) fakes the claim by mutating the row and never runs the reaper; no test composes enqueue(required_tags) × registry(tags, paused, status) × claim × reaper queue-timeout × a budgeted back-edge.

**Decisions taken (user, 2026-08-30):** a run whose node has no capable cluster **parks until capacity appears** (llm-gate shape, plus a one-time notice, plus a durable reason so it is never a silent park); the claim endpoint signals paused via **`204` + response header**.

**Operator step (not a slice, do first, user's call):** unpause `central` (`PUT /api/cluster-agents/{id}/paused`, or the Clusters page) if the satellite experiment is over, and remove `lore:blocked` from #1629 #1634 #1647 #1648 #1650 so the driver can re-pick them. Until slice A ships, a paused central will keep killing tickets at 2h each.

## Open GitHub issues this plan touches (checked 2026-08-30)

| Issue | Relation | Plan |
|---|---|---|
| [#1654](https://github.com/re-cinq/lore/issues/1654) A paused cluster-agent is indistinguishable from an idle one, in both directions | **Exactly defects 3 + the reaper-message half.** Its two proposals ARE slices D (agent half) and A's registry-aware detail (reaper half). | Closed by A + D. Reference it in both PRs (`Closes #1654` on D). |
| [#1648](https://github.com/re-cinq/lore/issues/1648) central cluster-agent is paused and is the only provider of 7 of 8 node tags | The live incident. Asks two decisions: (1) is the pause deliberate, (2) should a second agent carry the non-agent tags. (1) is the operator step; (2) is redundancy, out of scope here — B makes the single-provider case *visible and non-destructive* rather than redundant. Ironically the loop picked this ticket and died of it. | Operator step + B. Comment with the outcome; leave open for decision (2) or close if unpausing is the answer. |
| [#1621](https://github.com/re-cinq/lore/issues/1621) 62 ingest station nodes sit queued past 30m unclaimed while central advertises node:ingest | Same root cause (its comment already found `paused`). Its follow-ups — pause should write an audit row; the reaper message should name the paused agent — are A (message) and a one-line addition to D: `setPaused` route writes `audit_log` `cluster_agent_paused`. | Fold the audit row into D. Close with A + D. |
| [#1625](https://github.com/re-cinq/lore/issues/1625) Single-Agent tasks still push to central instead of going through the claim queue | **Already done by #1651** — `agent-cr-station-backend.ts` now goes through `ensureStationRun` + `required_tags`; no push path remains. Slice F builds on that. | Close now with a pointer to #1651; F references it. |
| [#1618](https://github.com/re-cinq/lore/issues/1618) Satellites need a scoped station credential so they can serve station nodes | Why the satellite carries `node:agent` only, i.e. why one paused central starves validate. B's park reason should end with "satellites cannot serve station nodes until #1618". | Not in scope; B's reason text links it. |
| [#1627](https://github.com/re-cinq/lore/issues/1627) The Floor still reads Agent CRs from the central cluster on satellite paths | Adjacent: the reaper's `readAgentStatus` guard. This plan adds no new CR reads (the gate reads the registry, not the cluster). | Untouched; note in B's ADR paragraph. |
| [#1592](https://github.com/re-cinq/lore/issues/1592) Reaper cannot resolve a dropped event for a satellite-executed node | Adjacent reaper door; independent of queue-timeout. | Out of scope. |
| [#1135](https://github.com/re-cinq/lore/issues/1135) 100% LLM-node failure produced zero signal for two days | Same class of silence. B's one-time notice and E's run-page visibility answer its asks 1–2 for the *capacity* failure mode only. | Comment on it from B/E; leave open. |
| [#1547](https://github.com/re-cinq/lore/issues/1547) Validate station fails every run: no dependency install | Fixed in #1614 per memory; still open. Unrelated to this plan but the next thing validate will hit once it is claimable again. | Ask user to close or verify. |
| #1629 #1634 #1647 #1650 #1615 #1504 (`lore:blocked`) | Casualties of the incident, not causes. | Operator step: remove the label after unpausing. |

## Goal

An implementation-loop run whose node has no capable cluster costs zero LLM re-runs, says exactly which cluster is missing/paused/offline, waits for it, and is visible as waiting on the run page.

## Acceptance Criteria

- [ ] A node nobody claims within the queue wait fails the run once, with a reason naming the matching agents and their state; `implement` is never re-dispatched for it. (A)
- [ ] A paused cluster-agent logs one line saying so, and the reaper reason says "1 matching agent (central) is paused", not "no registered cluster-agent". (A, D)
- [ ] With every matching agent paused/offline, `advanceLine` mints no row, records `parked_reason` on the run, notifies once, and resumes by itself when an agent becomes capable. (B)
- [ ] With no registered agent offering a tag at all (registry non-empty), the run fails immediately as `unclaimed`. (B)
- [ ] The acceptance tier walks the real implementation-loop blueprint through the real registry, claim and reaper: paused-central → parks; unpaused → validate claimed by central → walk reaches `push`. (C)
- [ ] The run page shows, per visit: lifecycle status, required tags, claimant, claimed-at, failure class; and a parked run shows its `parked_reason`. (E)
- [ ] A single-CR task gets the same gate. (F)

## Rules that apply to every slice

- TDD: failing test first (`bender-the-tester` → `bender-the-coder` → `bender-the-architect`); tests use `InMemory*` doubles, never mocks.
- Every new `it()` needs a `([validated by title](path#Lnn))` link appended to the LAST parenthetical of an existing spec statement. Specs to amend (never create): `specs/running-stations-in-any-k8s-cluster/spec.md` (FR2 tags, FR3 claim, FR4 recovery, FR9 pausing), `specs/6-dark-factory/spec.md` (FR6 reaper), `specs/implementation-loop/spec.md` (FR3 retry budget). Re-anchor links AFTER prettier (memory: `project-spec-anchor-reanchoring`).
- Format = `eslint --fix && prettier` (a lint error skips prettier). `npm run build` in `libs/shared` / `libs/assembly-lines` before floor `tsc` (stale `dist/` typechecks the previous branch).
- lore-api: any response-schema change → `npm run gen:openapi && npm run gen:api-types` or `gen-openapi.test.ts` fails.
- No commits without the user's approval; one PR per slice; report failing output verbatim.
- **Every PR body names its issues with GitHub's closing keyword** — `Closes #N` per issue it finishes, `Refs #N` for issues it only advances — so merge closes them automatically. Per slice:
  - A: `Refs #1654` (reaper half), `Refs #1621`, `Refs #1648`
  - D: `Closes #1654`, `Closes #1621` (with A merged first — its message half is what #1621's follow-up asks for)
  - C: `Refs #1648`
  - B: `Closes #1648` (if the user decides unpausing is the answer; else `Refs #1648`), `Refs #1618`, `Refs #1135`
  - E: `Refs #1135`
  - F: `Refs #1625` (already closed by #1651 — close it by hand now with that pointer)

## Slices

### Slice A — An unclaimed node fails the run once, honestly; the walk never spends a retry on it (walking skeleton)

**Class**: behavior change. **Actor**: the ticket author / operator reading `failure_reason`. **Trigger**: reaper tick finds a `queued` row past the wait. **Outcome**: run ends `failed` after ONE 30m wait with a reason naming the matching agents; `enqueued` never contains `<run>-implement-2`.

**Path**: [assembly-run-reaper.ts](apps/floor/src/jobs/assembly-run/assembly-run-reaper.ts) queue-timeout arms (graph [:475](apps/floor/src/jobs/assembly-run/assembly-run-reaper.ts#L475), single-CR [:263](apps/floor/src/jobs/assembly-run/assembly-run-reaper.ts#L263)) → `finishNodeTerminal` → `getNextTransition` ([transition.ts:147](libs/assembly-lines/src/transition.ts#L147) `isPermanentNodeFailure`) → `finishLine`.

**Changes**
1. [libs/shared/src/error-classify.ts](libs/shared/src/error-classify.ts): add `"unclaimed"` to `FailureCategory`, `HINTS` ("No cluster-agent claimed it, so nothing ran. Check the registry: the agents offering these tags are named in the detail. Re-running cannot help until one is active and unpaused."), `CATEGORY_LABELS`, and `PERMANENT`. Update the comment at ≈L131 that enumerates absent classes. `categorize()` is untouched — this class is assigned by the reaper, never matched from text.
2. New pure module `libs/shared/src/project/cluster-agents/capacity.ts` (beside `required-tags.ts`, reusing `tagsSatisfy`):
   ```ts
   export type CapacityVerdict =
     | { kind: "capable"; agents: ClusterAgent[] }
     | { kind: "all-unavailable"; reason: string }   // matches exist, all paused/offline
     | { kind: "none-registered"; reason: string }   // registry non-empty, no tag match
     | { kind: "registry-empty" };                    // boot / outage → callers fail open
   export function capacityFor(required: string[], agents: ClusterAgent[]): CapacityVerdict
   ```
   Reason strings: `no registered cluster-agent offers [node:validate]` / `1 matching cluster-agent (central) is paused` / `2 matching (central, gpu-1): central paused, gpu-1 offline`. Slice B reuses this; nothing else describes capacity.
3. Reaper (currently reads `Date.now()` at [:217](apps/floor/src/jobs/assembly-run/assembly-run-reaper.ts#L217) and `stationQueueWaitMs()` at [:218](apps/floor/src/jobs/assembly-run/assembly-run-reaper.ts#L218)): `AssemblyLineReaperDeps` gains `now?: () => Date` (default `Date.now`), `queueWaitMs?: number` (default `stationQueueWaitMs()`), `listClusterAgents?: () => Promise<ClusterAgent[]>`. Both queue-timeout arms stamp `failureClass: "unclaimed"` and detail `no cluster-agent claimed this run (required_tags: [...]) within 30m — <capacityFor reason, or "N capable agent(s) (names) active but did not claim — wedged?">`. Wire `listClusterAgents: () => clusterAgents().list()` in [cron.ts](apps/floor/src/jobs/cron.ts) ≈L113.
4. Transition/failure-reason: no code change expected — `isPermanentNodeFailure` already refuses the back-edge for a PERMANENT class; the tests prove it.

**RED (write first)**
- `error-classify.test.ts`: `unclaimed` is permanent; hint text.
- `capacity.test.ts` (new, colocated): the four verdicts + exact reason strings.
- `transition.test.ts`: a `validate` visit `{outcome:"failed", failureClass:"unclaimed"}` on `implementation-loop`'s `validate->implement` edge → `{kind:"fail", outcome:"error", reason: contains detail}`, never `launch implement iter 2`.
- `assembly-run-reaper.test.ts`: (i) queue-timeout arm stamps `unclaimed` + registry-aware detail with a paused `central` in `listClusterAgents`; (ii) NEW graph test using `loadBuiltinAssemblyLines().get("implementation-loop")`: implement success → validate queued 45m → one sweep → run `finished`/`failed`, `enqueued.map(name)` has no `-implement-2`; (iii) `now`/`queueWaitMs` deps replace `process.env` mutation in the existing `stationQueueWaitMs` tests.

**GREEN**: the four changes above, nothing more. **MUTATE**: N/A (Stryker not configured); alternate evidence = the reaper graph test asserting the absent second launch. **REFACTOR**: fold the two duplicated queue-timeout detail strings into one `unclaimedDetail(node, waitMs, verdict)`.

**Spec amendments**: 6-dark-factory FR6 (reaper queue-timeout statement: class `unclaimed`, PERMANENT, message names agents); running-stations FR4 (same); implementation-loop FR3 ("`validate` failing routes back…" gains: an unclaimed `validate` is not a `validate` failure and spends no budget).

**Done when**: all RED tests green, `failure_reason` on a fresh run reads the new sentence, the run's second `implement` row never exists.

---

### Slice D — A paused cluster-agent can tell it is paused, once (issue #1654, agent half)

**Class**: behavior change. **Actor**: the satellite/central operator reading pod logs. **Trigger**: claim poll while `paused`. **Outcome**: one log line on transition into paused, one on leaving; idle backoff unchanged.

**Path**: [claim.ts](apps/lore-api/src/api/routes/cluster-agents/claim.ts) `handleClaim` → `claimOnce` → `runClaimLoop` in [claim-loop.ts](apps/cluster-agent/src/claim/claim-loop.ts).

**Changes**
1. `handleClaim` paused branch returns `{ code: 204, paused: true }`; the route sets header `x-lore-claim: paused` on that 204. Body stays empty → no OpenAPI change.
2. (#1621 follow-up) [pause.ts](apps/lore-api/src/api/routes/cluster-agents/pause.ts) writes an `audit_log` row `cluster_agent_paused` `{cluster_agent_id, name, paused}` so "who paused it, when" has an answer next time.
3. `ClaimOutcome` gains `{ kind: "paused" }`; `claimOnce` maps `204 + header` to it. `nextClaimDelay` treats `paused` like `empty` (backoff). `runClaimLoop` keeps the previous outcome kind and logs `[cluster-agent] paused by an operator — claiming nothing until un-paused` on entering, `[cluster-agent] un-paused — claiming again` on leaving.

**RED**: `claim.test.ts` (paused → header present; unpaused 204 → header absent), `claim-loop.test.ts` (header → `paused`; paused ticks back off; log once across N paused ticks, once on un-pause). **GREEN/REFACTOR**: as above; `onOutcome` transition tracking lives in `runClaimLoop`, not the tick. **MUTATE**: N/A; evidence = the "logged once" assertion counts lines.

**Spec amendments**: running-stations FR9 (the "byte-identical 204" statement is rewritten: identical to a probe, distinguishable to the agent via header) and FR3 (204 statement).

**Done when**: a paused agent's log shows exactly one paused line; `claim.test.ts:90` expectation updated, not deleted.

---

### Slice C — The dispatch tier is walkable without a cluster (harness; horizontal exception unlocking B)

**Class**: pure refactor of test infrastructure + behavior characterization. **Unlocks**: slice B's RED at the acceptance tier. **Verification**: two acceptance tests on the real `implementation-loop` blueprint pass against slice-A behavior.

**Changes to [line-acceptance-harness.ts](apps/floor/src/jobs/assembly-run/line-acceptance-harness.ts)**
- Own an `InMemoryClusterAgents` (from [cluster-agents-memory.ts](libs/shared/src/project/cluster-agents/cluster-agents-memory.ts)); `createLineHarness({ agents?: Array<{name, tags, paused?}> })` registers them; default = `central` with `CENTRAL_TAGS` (lift the constant out of [single-cr-dispatch-acceptance.test.ts:37](apps/floor/src/jobs/station/single-cr-dispatch-acceptance.test.ts#L37) into a shared test fixture module, e.g. `libs/shared/src/project/cluster-agents/central-tags.fixture.ts`, imported by both).
- `claimAs(name)`: goes through the REAL `handleClaim` (import from lore-api route module — it is pure and injectable) with `{ agents, runs }` and the agent's minted token; returns the `ClaimOutcome`-shaped result. `completeAgentNode` stops mutating the row: it requires the row to be `claimed` and fails loudly otherwise (a test that forgets to claim is a test that skipped the tier).
- `pause(name)` / `unpause(name)` via `agents.setPaused`.
- `reap({ minutesLater })`: runs the real `assemblyLineReaperJob` on the harness deps + `{ taskStatus, listClusterAgents: () => agents.list(), centralClusterAgentId, offlineClusterAgents, now: () => shifted, queueWaitMs }` — the `now`/`queueWaitMs` deps from slice A are what make this possible without env mutation. Row ages come from `runs.clock` (the reaper test's existing trick).
- Existing acceptance suites (`feature-planning-acceptance`, `code-review-acceptance`, `implementation-loop-acceptance`) gain a `claimAs("central")` before each `completeAgentNode` — mechanical, and it is the point: every walk now passes through the claim.

**Tests (characterize slice A)** in `implementation-loop-acceptance.test.ts`:
- `with central paused, validate is never claimed and after the queue wait the run fails unclaimed without a second implement` — claimAs("central") for implement, complete it, `pause("central")`, `claimAs("central")` → `{kind:"empty"}` (D not required here), `reap({minutesLater: 31})`, assert run `failed`, reason contains `central) is paused`, `enqueued` has no `-implement-2`, `labeled` has `lore:blocked`.
- `with central active, validate is claimed by central and the walk reaches push` — assert the validate row's `clusterAgentId` is central's id and `enqueued` ends with `-push`.

**Spec amendments**: running-stations FR3 (claim statement gains the acceptance links); implementation-loop FR3.

**Done when**: all four acceptance suites green with the real claim in the path; no test mutates `runs.nodes[*].status` directly.

---

### Slice B — A node with no capable cluster parks, says why, and resumes on its own

**Class**: behavior change. **Actor**: the ticket author (nothing burned, nothing blocked) and the operator (one notice). **Trigger**: `advanceLine` reaching a pod node. **Outcome**: no row minted; `assembly_runs.parked_reason` set; one notification per gate transition; on the next reaper re-drive after capacity returns, the row is minted and `parked_reason` cleared.

**Path**: [advance.ts](apps/floor/src/jobs/assembly-run/advance.ts) `advanceLine` (new check right after the `llmGate` check, before `resolveNodeDispatch`) → `deps.capacity(requiredTags)` → park | fail | continue. Reaper's existing "running row, no open node → advanceLine" arm re-drives.

**Rule** (three-way, from `capacityFor`):
| verdict | action |
|---|---|
| `capable` / `registry-empty` / registry threw | mint the row as today (fail-open; llm-gate's boot bias, and the reaper already treats an empty registry as pre-claim behaviour) |
| `all-unavailable` | **park**: `assemblyRuns.setParked(id, reason)`; return |
| `none-registered` | **fail now**: `finishLine(run, "error", "node \"validate\" cannot run: " + reason)` — a tag nobody registers is config, not weather |

**Changes**
1. Migration `0053_assembly_run_parked_reason.sql`: `ALTER TABLE pipeline.assembly_runs ADD COLUMN IF NOT EXISTS parked_reason text;` (append-only, idempotent). Model [models/assembly-run.ts](libs/shared/src/models/assembly-run.ts): `parkedReason: z.string().nullable()` + column map. Port `AssemblyRunsPort.setParked(id, reason: string | null)`; Pg + InMemory adapters; contract test.
2. `AdvanceDeps.capacity?: (requiredTags: string[]) => Promise<CapacityVerdict>` — optional seam like `llmGate`. Production in [node-event-handler.ts](apps/floor/src/jobs/assembly-run/node-event-handler.ts) `productionNodeEventDeps`: `capacityFor(tags, await clusterAgents().list())` with a try/catch → `{kind:"registry-empty"}` on throw (log warn).
3. `advanceLine`: compute `requiredTags` once (move the `resolveRequiredTags` call up; it is already needed for `ensureStationRun`), consult `capacity` only for `dispatchedAsPod` nodes. Park clears on mint: `setParked(id, null)` right after `ensureStationRun` succeeds (only when it was set — one read on the row you already hold).
4. Notice: `CapacityNotice` throttle keyed `${runId}:${nodeId}` (in-memory, replicaCount:1 argument as llm-gate) → `notifyFailure`-style seam `notifyParked?(run, node, reason)`; production posts the run's repo `notify.notify("warning", …)` once per transition and logs at warn every re-drive.
5. Amend ADR-024 §"Cluster authority is exercised through a per-cluster agent" with one paragraph: dispatch consults the registry before minting; park vs fail rule; fail-open rationale.

**RED (acceptance first, then units)**
- `implementation-loop-acceptance.test.ts`: rewrite slice C's paused test to the new expectation — after `pause("central")` and `reap({minutesLater: 31})` the run is still `running`, `visits()` ends at `["implement","success"]`, `runs.getById(id).parkedReason` contains `(central) is paused`, notices has exactly one entry; then `unpause("central")`, `reap()`, `claimAs("central")` → claims validate, `parkedReason` is null. New test: `a tag no agent registers fails the run at once` (agents = satellite `node:agent` only + one unrelated agent so the registry is non-empty) → run `failed`, reason `no registered cluster-agent offers [node:validate]`, no row for validate.
- `advance.test.ts`: fail-open on `registry-empty` and on a throwing `capacity`; human/service nodes never consult `capacity`; `setParked(null)` on mint.
- `assembly-runs.contract.test.ts`: `setParked` round-trip (Pg + InMemory).

**GREEN/REFACTOR**: as above; keep `advanceLine` flat — extract `decideDispatchGate(verdict): "mint" | "park" | "fail"` as a pure function so the table above is one switch with tests, not nested ifs. **MUTATE**: N/A; evidence = the acceptance test's "no row minted" + "row minted after unpause".

**Spec amendments**: running-stations FR2 (tags: enqueue consults capacity; three-way rule) and FR9 (a paused agent's queued work: none is enqueued for it); 6-dark-factory FR6 (park is the second park-not-fail arm beside the LLM gate); implementation-loop FR3.

**Done when**: the acceptance tests above pass; `ui-helm` migration applies locally via `scripts/infra/setup-local-schema.sh`; a paused central on a live run produces one Slack/PR notice and no second implement.

---

### Slice E — The run page shows why a visit is waiting or who ran it

**Class**: behavior change (read surface). **Actor**: anyone on `/assembly-runs/{id}`. **Outcome**: each visit row shows lifecycle status, required tags, claimant, claimed-at, failure class; a parked run shows a "waiting for capacity: <parked_reason>" banner.

**Changes**
1. [assembly-lines.ts](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.ts) `StationRunRowSchema` + `/nodes` mapper: `status`, `required_tags`, `cluster_agent_id`, `claimed_at`, `failure_class`, `failure_detail` (all already on `StationRunRecord`). [run-read.ts](apps/lore-api/src/api/routes/assembly-lines/run-read.ts) `RunReadSchema`: `parked_reason`. `npm run gen:openapi && npm run gen:api-types`.
2. [apps/web-ui/src/lib/assembly-runs.ts](apps/web-ui/src/lib/assembly-runs.ts) `AssemblyRunNode` + `toAssemblyRunNode` + `AssemblyRun` mapper.
3. [RunNodeDetail.tsx](apps/web-ui/src/app/assembly-runs/[id]/RunNodeDetail.tsx): a "Dispatch" block (status · tags · claimant · claimed N min after enqueue · failure class + detail). [page.tsx](apps/web-ui/src/app/assembly-runs/[id]/page.tsx) → view: parked banner from `parkedReason`. Container/presentational split as the folder already does; view does no I/O.

**RED**: `assembly-lines.test.ts` (route projects the six fields), `run-read.test.ts` (`parked_reason`), `assembly-runs.test.ts` (mapper), `RunNodeDetail.test.tsx` (queued row renders tags + "waiting", claimed row renders claimant), view test for the banner. **MUTATE**: N/A; evidence = `gen-openapi.test.ts` drift guard + component tests. Coverage gate is 90% in web-ui — test the view, not the page.

**Spec amendments**: running-stations FR7 (registered-clusters visibility: the run page half) and FR3.

**Done when**: a queued visit on the live run page reads "queued 4m · needs node:validate · no claimant" and a finished one names its cluster.

---

### Slice F — A single-CR task gets the same gate

**Class**: behavior change. **Actor**: author of a runbook/onboard/general task. Note #1651 already moved this path onto the claim queue (`ensureStationRun` + `resolveRequiredTags`, [:96](apps/floor/src/jobs/station/agent-cr-station-backend.ts#L96)), so this slice only adds the gate. **Path**: [agent-cr-station-backend.ts](apps/floor/src/jobs/station/agent-cr-station-backend.ts) `launch` [:96](apps/floor/src/jobs/station/agent-cr-station-backend.ts#L96) → same `capacityFor` → `none-registered` fails the task at launch with the reason; `all-unavailable` parks the run row with `parked_reason` (the reaper's "backing task terminal" arm is unaffected; add a re-drive for parked single-CR rows: on each sweep, a single-CR run with `parkedReason` and no open visit re-runs `launch`'s enqueue via a small `enqueueVisit` method extracted from `launch`).

**RED**: `single-cr-dispatch-acceptance.test.ts` (paused central → no visit, `parkedReason` set; unpause + sweep → visit queued → claim → CR); `agent-cr-station-backend.test.ts` (none-registered → `launched:false` + reason). **Spec**: running-stations FR3 (single-CR statement). **Done when**: both pass and the reaper re-drive is covered.

## Pre-PR Quality Gate (each slice)

1. `npm run build` in touched `libs/*`, then `npx tsc --noEmit` + `npx eslint .` + `npx prettier --check` in each touched app.
2. `npx vitest run` in each touched package (floor's coverage gate is an explicit include list — new production files must be added to it).
3. Spec links: `npx eslint specs/ adrs/` clean (require-spec-link / no-dead-spec-links / status-matches-coverage); re-anchor after prettier.
4. lore-api: `gen-openapi.test.ts` green after regeneration (E only).
5. `/four-rules-report` on the diff; `/pr` for the description.

## Verification (end to end, after B + D + E)

1. Local stack: `npm start`; register central + a `node:agent`-only satellite (or pause central on GKE with a throwaway repo and one `priority:low` issue).
2. Enable `implementation_loop` on the repo; watch `/assembly-runs/{id}`: implement claimed → validate shows "waiting for capacity: 1 matching cluster-agent (central) is paused"; central pod log shows exactly one `paused by an operator` line; Slack/PR carries one notice; `station_runs` has ONE implement row.
3. Unpause: within 60s validate is claimed by central, banner clears, walk reaches `push`/`await-pr`.
4. Negative: register nothing for `node:validate` (edit central's tags) → run fails at once with `no registered cluster-agent offers [node:validate]`, `implement` never re-runs, issue gets `lore:blocked` with that sentence.
5. Task API: `lore_get_pipeline_status` reason reads the new wording; `GET /api/assembly-runs/{id}/nodes` returns the six new fields.

## Out of scope

Same-node requeue for a wedged-but-capable agent (a different mechanism); a per-agent concurrency cap (none exists, so "capable but unclaimed 30m" = wedged); auto-unpausing anything; repairing the five blocked tickets (operator step above).
