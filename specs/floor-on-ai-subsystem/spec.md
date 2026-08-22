# Feature Specification: Floor task execution on the ai-agent-subsystem

| Field          | Value                                                                 |
|----------------|-----------------------------------------------------------------------|
| Feature        | Floor → ai-agent-subsystem cutover (retire LoreTask)                  |
| Status         | In Progress                                                             |
| Created        | 2026-06-25                                                            |
| Owner          | Platform Engineering                                                  |
| ADR            | [`ADR-031`](../../adrs/ADR-031-agent-station-crds.md) (supersedes ADR-011 + ADR-030 storage) |
| Epic           | [#690](https://github.com/re-cinq/lore/issues/690)                   |
| Subsystem      | [`re-cinq/ai-agent-subsystem`](https://github.com/re-cinq/ai-agent-subsystem) (`agents.re-cinq.com` / `ai-agents`) |

This spec retires Lore's bespoke LoreTask CRD execution path and moves all Floor task execution onto the ai-agent-subsystem's Agent CRs, preserving Lore's deterministic guarantees by relocating context hydration, validation, commit/push, PR creation, and the assembly line Floor-side.

> **Revised 2026-07:** generalized so **every** assembly-line node — not just agent nodes — runs as an
> `Agent` CR / pod; non-LLM "station" nodes (validate/gate/retrospective/`github_action`/detect/custom)
> run via a new `exec` vendor. Folded into the Solution, D9, the architecture, File Changes, and AC15–21.

> **Revised again late 2026-07 (cutover complete):** the LoreTask path, its cluster gate, and the
> two-gate `decideExecutionBackend` routing are gone — every task runs on Agent CRs. The Floor-side
> `executeAssemblyLine` walker this spec introduced was itself retired: the walk is now event-driven
> (`nextTransition` replays `pipeline.assembly_line_nodes`; `advance.ts` drives it per node-CR terminal
> event — `specs/6-dark-factory/spec.md` FR6.7–FR6.10), so there is no in-Floor walker process, no
> branch-lease heartbeat, and no stage-trailer resume. The in-process JSON-supervisor for
> gap-fill/runbook was also removed: gap-fill runs on the Floor AssemblyLine, runbook as a single
> Agent CR. Read the walker-era mechanics below (D4, the architecture sketch, AC11) as the state at
> cutover time, restated where noted.

## Problem Statement

Lore executes coding tasks today via a bespoke `LoreTask` CRD → `loretask-controller` → a
`lore-claude-runner` Job pod that does *everything* in-pod (context hydration, `claude --print`,
lint/typecheck validation, commit/push with `Lore-*` trailers, and — for dark-factory repos — a
multi-node assembly line). A `loretask-watcher` then opens the PR, auto-reviews, auto-merges, and
escalates. This substrate is Lore-specific, unsigned, and entangled with the rest of the platform.

A clean-sheet operator — `ai-agent-subsystem` — already runs autonomous coding agents as
first-class Kubernetes resources (signed images, supervisor + initializer, its own CI). It is a
**pure execution engine**: it provisions a repo, runs the agent, and streams output. It deliberately
does **not** do context hydration, validation, commit/push, PR creation, retry, or multi-node
assembly lines.

We want all Floor task execution to run on that subsystem and to retire the LoreTask path — without
losing any of Lore's deterministic guarantees.

- A UI-authored recipe carries the same live Lore MCP entry and pipeline-tool deny as a seeded one. It carried NEITHER: a repo that overrode its recipe through `/agents` got a run with no `lore` server, so the agent silently lost the mid-run memory and context access every seeded recipe has, and lost the guard that stops it spawning more pipeline work from inside a run. Injected at CR-render time rather than surfaced as an editable field, because a capability every recipe needs should not depend on each author remembering to add it. The gateway URL comes from the DEPLOY value, never the recipe row — a host stored in the database would outlive the rollout that moved it — so an unset value leaves `mcp_servers` off entirely rather than pointing a pod at something unreachable. The deny is unconditional for the opposite reason: making it depend on deploy config would drop it exactly where the config is wrong. Stations get it too, since a custom station reads and writes through the same API surface. ([validated by carries the live Lore MCP gateway onto a UI-authored recipe](apps/lore-api/src/features/agents/agent-crd.test.ts#L80), [`agent-crd.test.ts:98`](apps/lore-api/src/features/agents/agent-crd.test.ts#L98), [`agent-crd.test.ts:111`](apps/lore-api/src/features/agents/agent-crd.test.ts#L111), [`agent-crd.test.ts:119`](apps/lore-api/src/features/agents/agent-crd.test.ts#L119); implemented by [`agent-crd.ts:56`](apps/lore-api/src/features/agents/agent-crd.ts#L104))
- A UI save REPLACES nothing it does not render *(added 2026-08-18, #1301)*: the /agents apply path carries every field the live CR holds that the editor's mapping does not know — `output.watch`, helm's labels and annotations — through the replace, with the editor winning only the fields it renders. A plain replace amputated `output.watch` from the feature-planning recipe on 2026-08-13 and silently killed planning-artifact delivery for five days. ([validated by carries output.watch through a save whose render does not know it](apps/lore-api/src/features/agents/agent-crd.test.ts#L196), [`agent-crd.test.ts:204`](apps/lore-api/src/features/agents/agent-crd.test.ts#L204), [`agent-crd.test.ts:217`](apps/lore-api/src/features/agents/agent-crd.test.ts#L217), [`agent-crd.test.ts:225`](apps/lore-api/src/features/agents/agent-crd.test.ts#L225); implemented by [`agent-crd.ts:37`](apps/lore-api/src/features/agents/agent-crd.ts#L37))

## Solution

Make the `ai-agent-subsystem` the **production execution substrate** and turn the **Floor into the
orchestrator** that wraps it. The subsystem's CRDs (`AgentDefinition` / `Station` / `Agent`,
`agents.re-cinq.com`) are the **source of truth**, edited via the web UI which applies YAML to the
cluster. The Lore-specific glue is **relocated Floor-side** and stays deterministic:

- A new **`AgentBackend`** (the existing `StationBackend` port) creates `Agent` CRs instead of
  `LoreTask` CRs; a two-gate flag routes tasks during a graded, reversible cutover.
- A Floor-side **`agent-watcher`** (replacing `loretask-watcher`) computes changed files, reads the
  **GitHub Actions** CI gate, opens the PR (`Lore-Task` footer), auto-merges, and escalates.
- The **assembly line** (`libs/assembly-lines`) is walked by the Floor; **every node
  dispatches one `Agent` CR** — AI nodes run `claude`; non-AI **station** nodes
  (validate/gate/retrospective/detect) run the deterministic `lore-station` image via the subsystem's
  `exec` vendor; a `github-action` node references the repo's GitHub Actions. *(Originally an
  in-process `executeAssemblyLine` walker with a heartbeated branch lease; since the late-2026-07
  restatement the walk is event-driven — `nextTransition` over the persisted node rows, no walker
  process, no lease.)*
- The recipe **schema + client are generated from the subsystem's D structs** into a published
  code-API package (`@re-cinq/agent-contracts`, subsystem v0.3.0) that the Floor and UI import.
- Secrets, context hydration, networking, and observability **reuse the existing setup** (ESO
  remoteRefs, public-LB hydration, an NDJSON http sink into `pipeline.llm_calls`/OTEL/`agent_run_turns`).

The cutover is reversible (both controllers run in parallel behind a flag); `LoreTask`, the
`claude-runner` image, and the cluster-wide `loretask-agent` RBAC are torn down only after a soak.

### Design decisions (locked) — D1–D9 (see ADR-031)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **D1** Substrate | Production runs on the **D standalone** `ai-agent-subsystem` (`agents.re-cinq.com` / `ai-agents`); the in-tree TS `k8s/` PoC is **deleted** | One signed, mature substrate; no two half-built copies |
| **D2** Source of truth | The **CRDs are authoritative**; the web UI edits YAML → applies to k8s; ADR-030's Postgres recipe store retired; schema + client **generated from D** into `@re-cinq/agent-contracts` | The cluster object is the truth; the contract can't drift |
| **D3** Validation | Non-AI assembly line steps **reference GitHub Actions**; the Floor gates on the run **conclusion** | The engine runs `claude` directly; GitHub runs the repo's real toolchain — deterministic, no toolchain in the Floor |
| **D4** Assembly line | The walk runs **Floor-side**; each node dispatches one `Agent` CR. *(As locked: an in-process `executeAssemblyLine` awaiting status under a heartbeated lease. Superseded by the event-driven walk — `nextTransition` re-derives the next step from `pipeline.assembly_line_nodes` on each node-CR terminal event; no awaiting process, no lease — 6-dark-factory FR6.9.)* | The assembly-line engine is process-agnostic; resume/`iteration_max` derive from persisted state |
| **D5** Context hydration | Floor injects context into `Agent.spec.parameters`; code recipes also wire the Lore MCP server | Turn-1 context, deterministic, no in-pod network dependency |
| **D6** Secrets | **Inherit** the existing GCP Secret Manager remoteRefs via ESO into `agent-secrets`; per-task GitHub App token PATCHed in and removed on terminal | No new secret material; short-lived, least-privilege; no org PAT |
| **D7** Networking | Self-hydration + telemetry over the **public LB**; run pods **drop direct Postgres** | The run-pod NetworkPolicy blocks RFC1918/metadata; DB-less pods shrink blast radius |
| **D8** Observability | NDJSON **http sink → Floor `/api/agent-events`** → `pipeline.llm_calls` + OTEL + `agent_run_turns` + UI logs | No telemetry capability lost; pod stays DB-less and GCS-less |
| **D9** Station nodes | **Every** non-agent node (validate/gate/retrospective/`github_action`/detect/custom) dispatches its own `Agent` CR run by the `exec` vendor (`model: exec` → `tool_config.command`); outcome via the `LORE_NODE_RESULT` result line. Cutover complete — no per-type flag; detector cores relocated to `@re-cinq/lore-shared/detect` so the detect node dispatches a station too | Uniform per-node isolation + timeouts; custom station images; no CRD change |

## Architecture (target data-flow, one `implementation` task)

```
pending task ─► Floor coordinator (event-driven walk: start handler launches the entry node,
                each node-CR terminal event advances via nextTransition over the node rows)
  ├─ implement (AI node) ─► AgentBackend creates an Agent CR ─► ai-agent-subsystem controller
  │                          (init clones repo + installs claude) ─► supervisor runs claude --print
  │                          ─► edits + commits (Lore-* trailers) + pushes ─► status: Succeeded
  ├─ validate (station node) ─► AgentBackend creates an Agent CR (exec vendor, lore-station image)
  │                          ─► runs createValidateHandler ─► LORE_NODE_RESULT line ─► gate on outcome
  ├─ review / address (AI nodes) ─► more Agent CRs, bounded by iteration_max
  └─ retrospective / merge ─► Floor-side handlers
agent-watcher ─► changed files (compare-commits) ─► CI gate ─► open PR (Lore-Task footer)
              ─► auto-merge / escalate / Slack / episode
http sink ─► Floor /api/agent-events ─► pipeline.llm_calls + OTEL + agent_run_turns + UI
```

## File Changes (high level — detail per ticket)

| Area | Change |
|------|--------|
| `re-cinq/ai-agent-subsystem` | NEW generator (D) → `@re-cinq/agent-contracts` TS package; v0.3.0 release (#82) |
| `terraform/modules/gke-mcp/ai-agents-helm/` + `infra/terraform/*.tf` | NEW Helm chart + ESO/RBAC (#682) |
| `apps/floor/src/adapters/agent-cr-backend.ts` | NEW `AgentBackend` + `decideExecutionBackend` (#683) |
| `apps/floor/src/application/jobs/scheduled/agent-watcher.ts` | NEW Floor-side watcher (#684) |
| `apps/web-ui` `/agents` + terraform seed | UI edits CRD YAML → applies to k8s; seed from current setup (#685) |
| `apps/floor` `POST /api/agent-events` | NEW NDJSON telemetry sink (#687) |
| `libs/assembly-lines/src/agent-node-handler.ts` + `github-action` node | NEW Floor-side graph nodes (#686) |
| `apps/floor` flag + `terraform` | Graded cutover + LoreTask teardown (#688) |
| `adrs/` + `specs/` | LoreTask references retired (#689) |
| `re-cinq/ai-agent-subsystem` `vendors/exec/` | NEW `exec` vendor — runs `tool_config.command`, no CRD change (D9) |
| `libs/assembly-lines/src/station-node-handler.ts` | Generalize per-node dispatch to ALL node types + `parseNodeResult` (D9) |
| NEW `apps/lore-station/` + Dockerfile + `build-lore-station.yml` | The `lore-station` station-pod image (validate; more node types phased in) |
| `scripts/task-types.yaml` `stations:` + `gen-catalog` + migration `0027` | Seed `def-<type>` station recipes (D9) |
| `apps/floor` `nodeStationSpec` + always-station handlers | Station dispatch spec; every non-agent node dispatches a station (D9) |
| `libs/shared/src/detect/*` (relocated) + `apps/lore-station/src/stations/*` | Detector cores moved to shared (facade-driven); one station module per node type |
| `apps/lore-api` chunks + station-data endpoints + `createStationProject` | Pod-side HTTP surface: chunk reads, issues/tasks/pulls/settings, so a station never touches Postgres/App creds (D7) |

## Acceptance Criteria

> Each criterion is implemented test-first; as a ticket's tests go green it adds the inline
> `([validated by <name>](path/to/test.ts#Lnn))` link to the criterion it satisfies
> (spec-test-coverage v3). Criteria are un-linked here until their PR lands.

1. ADR-031 is rewritten to make the subsystem the production substrate, recording D1–D9, and
   superseding ADR-011 + ADR-030's storage decision; ADR-030 carries a superseded-storage banner.
2. The `AgentDefinition`/`Station`/`Agent` TypeScript types + client are **generated from the
   subsystem's D structs** (crdgen-style) and published as `@re-cinq/agent-contracts@0.3.0`; a CI
   drift check fails on stale output.
3. The subsystem is deployed by the existing `terraform apply` via a Helm chart: the controller is
   `2/2` Ready with the Lease held, and `agent-secrets` is sourced from the existing GCP Secret
   Manager remoteRefs (no new secret material).
4. `decideExecutionBackend` routes a task to the Agent-CR path only when both gates (per-repo setting
   + cluster env) are on; otherwise it returns the LoreTask path.
5. `AgentBackend.launch` produces a correct `Agent` CR from a task (stationRef from task type,
   parameters populated, `taskId` label), and resolves activeness by label. `taskIdOf`/`taskTypeOf`
   read exactly the `lore.re-cinq.com/task-id` + `task-type` labels `AgentCrBackend` sets and return
   undefined when they are absent. `AgentCrBackend.launch` injects the assembled context into the CR
   parameters (omitting it when the source is absent or returns undefined), maps the task to the CR
   (stationRef=taskType, task-id/task-type labels, description/prompt/pr_number parameters, explicit
   name + extraLabels honoured), returns `launched:false` on a 409, runs the Agent on the per-task
   Station the provisioner returns (falling back to the catalog Station, skipping provisioning for a
   repo-less task), and resolves `isActive` by the task-id label (true while any matching Agent is
   non-terminal, conservatively true when the probe fails). ([validated by `agent-watcher-logic.test.ts:14`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L14), [`agent-watcher-logic.test.ts:27`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L27), [`agent-backend.test.ts:52`](apps/floor/src/jobs/station/agent-backend.test.ts#L52), [`agent-backend.test.ts:57`](apps/floor/src/jobs/station/agent-backend.test.ts#L57), [`agent-backend.test.ts:65`](apps/floor/src/jobs/station/agent-backend.test.ts#L65), [`agent-backend.test.ts:89`](apps/floor/src/jobs/station/agent-backend.test.ts#L89), [`agent-backend.test.ts:95`](apps/floor/src/jobs/station/agent-backend.test.ts#L95), [`agent-backend.test.ts:104`](apps/floor/src/jobs/station/agent-backend.test.ts#L104), [`agent-backend.test.ts:127`](apps/floor/src/jobs/station/agent-backend.test.ts#L127), [`agent-backend.test.ts:144`](apps/floor/src/jobs/station/agent-backend.test.ts#L144), [`agent-backend.test.ts:154`](apps/floor/src/jobs/station/agent-backend.test.ts#L154), [`agent-backend.test.ts:176`](apps/floor/src/jobs/station/agent-backend.test.ts#L176), [`agent-backend.test.ts:185`](apps/floor/src/jobs/station/agent-backend.test.ts#L185), [`agent-backend.test.ts:196`](apps/floor/src/jobs/station/agent-backend.test.ts#L196), [`agent-backend.test.ts:226`](apps/floor/src/jobs/station/agent-backend.test.ts#L226), [`agent-backend.test.ts:232`](apps/floor/src/jobs/station/agent-backend.test.ts#L232), [`agent-backend.test.ts:238`](apps/floor/src/jobs/station/agent-backend.test.ts#L238), [`agent-backend.test.ts:244`](apps/floor/src/jobs/station/agent-backend.test.ts#L244))

6. A `Succeeded` `Agent` with pushed changes results in a PR carrying the `Lore-Task` footer; an
   `Agent` with no changes completes the task with no PR.
7. The deterministic gate reads the **conclusion of the GitHub Actions referenced by the assembly line**:
   a red conclusion routes to the address loop, a green conclusion proceeds. ([validated by `agent-watcher-logic.test.ts:51`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L51), [`agent-watcher-logic.test.ts:55`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L55))

8. The `/agents` web UI edits an `AgentDefinition`/`Station` and **applies the YAML to Kubernetes**
   with no Postgres write; the Floor reads recipes from the CRDs via `@re-cinq/agent-contracts`.
9. Secrets in `ai-agents` are mirrored from the existing remoteRefs; the per-task GitHub token is
   added before a run, referenced by `token_secret`, and removed on terminal status. `decideTokenReclaim`
   reclaims a single-agent task's token only on a terminal phase (`Succeeded`/`Failed`), skips a
   non-terminal phase, and skips a task routed to a multi-node assembly line (its token is freed at
   line completion). Per-task provisioning derives the token-secret key + Station/Definition names
   from the first 8 of the task id, only provisions when the task targets a repo, injects the target
   repo (clone URL + branch ref, ref omitted when the spec has no branch + `token_secret`) into the
   renamed-and-task-id-labelled AgentDefinition (catalog recipe preserved, and rejected when the
   catalog row carries no prompt — the clone could not admit), and points the per-task
   Station's `agentDefRef` at it (template preserved, empty-template fallback). ([validated by `agent-watcher-logic.test.ts:65`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L65), [`agent-watcher-logic.test.ts:73`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L73), [`per-task-token.test.ts:57`](apps/floor/src/jobs/station/per-task-token.test.ts#L57), [`per-task-token.test.ts:76`](apps/floor/src/jobs/station/per-task-token.test.ts#L76), [`per-task-token.test.ts:79`](apps/floor/src/jobs/station/per-task-token.test.ts#L79), [`per-task-token.test.ts:92`](apps/floor/src/jobs/station/per-task-token.test.ts#L92), [`per-task-token.test.ts:107`](apps/floor/src/jobs/station/per-task-token.test.ts#L107), [`per-task-token.test.ts:117`](apps/floor/src/jobs/station/per-task-token.test.ts#L143), [`per-task-token.test.ts:123`](apps/floor/src/jobs/station/per-task-token.test.ts#L149), [`per-task-token.test.ts:135`](apps/floor/src/jobs/station/per-task-token.test.ts#L161), [`per-task-token.test.ts:152`](apps/floor/src/jobs/station/per-task-token.test.ts#L178), [`per-task-token.test.ts:170`](apps/floor/src/jobs/station/per-task-token.test.ts#L196))

10. Run output reaches the Floor over the public-LB http sink and is recorded in
    `pipeline.llm_calls`, OTEL spans, and the `pipeline.agent_run_turns` transcript (the UI log
    viewer shows it; the earlier GCS raw archive was retired 2026-08-11, #1148). `parseAgentEvents`
    maps each NDJSON terminal result envelope to one `llm_calls` row (model from `modelUsage` → flat
    `model` field → `unknown`; missing usage/cost/duration default to zero; non-result events,
    results with no usage, task-less lines, and non-object/blank/unparseable lines are skipped; one
    row per run across lines). The
    `POST /api/agent-events` sink rejects a request whose bearer token mismatches or whose internal
    token is unconfigured (401). The mapper MUST own no envelope-peeling of its own: it reads the
    attribution envelope through `unwrapAttribution`, the single unwrap side both lanes share, which
    peels `{source, event}` once and — transitionally, while the subsystem still emits the
    double-wrapped `{source, event: {source, event}}` lines observed on this sink — one further
    level, merging the two `source` objects with outer precedence so the terminal result at
    `.event.event` still yields its cost row. That peel MUST be bounded at two levels rather than
    looping, so a third envelope layer is left intact as the event and yields no row. ([validated by `agent-events.test.ts:15`](apps/floor/src/jobs/agent/agent-events.test.ts#L15), [`agent-events.test.ts:39`](apps/floor/src/jobs/agent/agent-events.test.ts#L40), [`agent-events.test.ts:51`](apps/floor/src/jobs/agent/agent-events.test.ts#L52), [`agent-events.test.ts:62`](apps/floor/src/jobs/agent/agent-events.test.ts#L63), [`agent-events.test.ts:72`](apps/floor/src/jobs/agent/agent-events.test.ts#L73), [`agent-events.test.ts:79`](apps/floor/src/jobs/agent/agent-events.test.ts#L80), [`agent-events.test.ts:142`](apps/floor/src/jobs/agent/agent-events.test.ts#L144), [`agent-events.test.ts:64`](apps/floor/src/delivery/http/routes/agent-events.test.ts#L67), [`agent-events.test.ts:72`](apps/floor/src/delivery/http/routes/agent-events.test.ts#L79), [`agent-events.test.ts:142`](apps/floor/src/jobs/agent/agent-events.test.ts#L144), [`agent-events.test.ts:131`](apps/floor/src/jobs/agent/agent-events.test.ts#L132), [`agent-output.test.ts:183`](libs/assembly-lines/src/agent-output.test.ts#L183), [`agent-output.test.ts:189`](libs/assembly-lines/src/agent-output.test.ts#L189), [`agent-output.test.ts:198`](libs/assembly-lines/src/agent-output.test.ts#L198), [`agent-output.test.ts:213`](libs/assembly-lines/src/agent-output.test.ts#L213), [`agent-output.test.ts:222`](libs/assembly-lines/src/agent-output.test.ts#L222), [`agent-output.test.ts:231`](libs/assembly-lines/src/agent-output.test.ts#L231), [`agent-output.test.ts:242`](libs/assembly-lines/src/agent-output.test.ts#L242), [`agent-output.test.ts:253`](libs/assembly-lines/src/agent-output.test.ts#L253), [`agent-output.test.ts:259`](libs/assembly-lines/src/agent-output.test.ts#L259), [`agent-events.test.ts:91`](apps/floor/src/jobs/agent/agent-events.test.ts#L92), [`agent-events.test.ts:118`](apps/floor/src/jobs/agent/agent-events.test.ts#L120); implemented by [`agent-output.ts:80`](libs/assembly-lines/src/agent-output.ts#L80))

11. *(restated late 2026-07)* A node CR's terminal status maps to a node outcome
    (`success`/`failed`/`changes_requested`) via `stationNodeOutcome` in the Floor's node-event
    handler; a forced Floor restart loses nothing because the walk is derived from the persisted
    `pipeline.assembly_line_nodes` rows, not held in memory — the original lease-heartbeat +
    stage-trailer-resume mechanics are retired (6-dark-factory FR6.9) ([validated by `node-outcome.test.ts:35`](libs/assembly-lines/src/node-outcome.test.ts#L34), [`advance.test.ts:362`](apps/floor/src/jobs/assembly-run/advance.test.ts#L363))
12. A `github-action` assembly line node dispatches the referenced GitHub Actions run and gates on its
    conclusion.
13. The cutover is reversible: flipping the cluster gate off routes new tasks back to LoreTask with
    no in-flight loss; after the soak, no new `LoreTask` CRs are created for any migrated task type.
14. After teardown, the `loretask-crd` module, the `claude-runner` image build, and the cluster-wide
    `loretask-agent` RBAC are removed; `adrs/` + `specs/` present no LoreTask as the current path.

### Station nodes (D9)

> Phased: validate (this change) → detect (needs chunk/trace/task HTTP ports) →
> gate/retrospective/`github_action` (auto-merge stays Floor-side) → custom stations +
> in-process handler deletion. Criteria link as each phase's PR lands.

15. `model: "exec"` routes to a non-LLM adapter spawning the recipe's `tool_config.command` with the
    rendered prompt appended; no CRD schema change. ([validated by agentForModel exec routing test](../ai-agent-subsystem/packages/agentcore/source/agentcore/vendors/select.d))

16. Node YAML accepts optional `station_ref` (custom station, default `def-<type>`) and
    `timeout_minutes`. ([validated by accepts station_ref and timeout_minutes on a node](libs/assembly-lines/src/loader.test.ts#L520))

17. `nodeStationSpec` builds the CR spec: stationRef, `parameters.station_input` JSON
    (assembly_line_id/node_id/node_type/repo/branch/task_id/params). ([validated by station-flagged node types dispatch a station CR](apps/floor/src/jobs/assembly-run/floor-assembly-run.test.ts#L134), [honors an explicit station_ref override](apps/floor/src/jobs/assembly-run/floor-assembly-run.test.ts#L176), [agent nodes thread station_ref too — a renamed recipe (code-review-refine) still resolves](apps/floor/src/jobs/assembly-run/floor-assembly-run.test.ts#L106))

18. A station pod ends with the claude-style result line carrying `LORE_NODE_RESULT: {outcome,
    extras}`; the Floor's `parseNodeResult` maps it (precedence: LORE_NODE_RESULT → REVIEW_RESULT →
    success); CR Failed → `station-failed`; await expiry → `station-timeout`. The wrap side and the
    unwrap side live in ONE module (`libs/assembly-lines/src/agent-output.ts`): `resultLine` emits
    the claude-style terminal event (`is_error:false`, `result` prefixed `LORE_NODE_RESULT: `) that
    round-trips through `parseNodeResult` and `resultTextFromOutput`, marks an infrastructure error
    `is_error:true` so the CR fails, and MUST refuse (enforce-throw) to wrap a payload that is
    already a wrapped agent output line — the envelope is applied exactly once, never nested.
    `eventLine` emits the non-terminal log events the result scan skips over.
    ([validated by parseNodeResult tests](libs/assembly-lines/src/node-outcome.test.ts#L20), [`agent-output.test.ts:270`](libs/assembly-lines/src/agent-output.test.ts#L270), [`agent-output.test.ts:281`](libs/assembly-lines/src/agent-output.test.ts#L281), [`agent-output.test.ts:293`](libs/assembly-lines/src/agent-output.test.ts#L293), [`agent-output.test.ts:301`](libs/assembly-lines/src/agent-output.test.ts#L301), [`agent-output.test.ts:311`](libs/assembly-lines/src/agent-output.test.ts#L311), [`agent-output.test.ts:319`](libs/assembly-lines/src/agent-output.test.ts#L319), [`agent-output.test.ts:329`](libs/assembly-lines/src/agent-output.test.ts#L329); implemented by [`agent-output.ts:180`](libs/assembly-lines/src/agent-output.ts#L180))

19. Cutover complete: every non-agent node on the Floor-assembly-line path dispatches a station
    (no `LORE_STATION_NODES` flag, no in-process node handlers on that path); the in-process
    supervisor path (gap-fill/runbook), untouched at cutover time, has since been removed too —
    gap-fill runs on the Floor AssemblyLine and runbook as a single Agent CR, both via
    `handleClaudeCodeTask` with no Floor-side clone or App token. ([validated by every non-agent node dispatches a station CR](apps/floor/src/jobs/assembly-run/floor-assembly-run.test.ts#L134))

20. `scripts/task-types.yaml` `stations:` seeds `def-<type>` AgentDefinition/Station pairs (exec
    model, `{station_input}` prompt, lore-station image via `.Values.stationImage`, deadline
    default 15); org rows seeded by migration 0027 (`execution_mode: 'station'`). The catalog
    builder maps each agent recipe to an AgentDefinition (prompt + `{context}`, `permission_mode`,
    `max_turns`, `ANTHROPIC_API_KEY` secret for the model key, the `lore` http `mcp_servers` entry —
    `headers_secret: lore-mcp-auth` — with `lore_create_pipeline_task` in `disallowed_tools` so the
    live run gets scoped Lore tools without a task-recursion vector, agent-events http sink; model
    omitted when the recipe has none) and Station (agentDefRef, deadline default 30, agent container), and
    each station recipe to a `def-<name>` exec pair (`model: exec`, `{station_input}` prompt,
    `tool_config.command`, station image, deadline default 15, RFC-1123-sanitised name, no ANTHROPIC
    secret — station recipes instead carry the `LORE_API_URL` env + `LORE_INGEST_TOKEN` secret every
    lore-station pod needs for its HTTP reads/writes); `buildCatalog` emits both kinds per type in
    order and `catalogChartYaml` emits them for the `catalog-seed` PRE-UPGRADE HOOK
    (`files/catalog-seed.yaml`, applied `--server-side --force-conflicts` AFTER the
    CRD hook so a lagging schema cannot prune a field on the way in). They were plain
    templates until #1468: helm patches a custom resource by diffing the PREVIOUS
    rendered manifest against the new one and never reads live state, so two recipes
    that lost `output.watch` to a stale CRD schema stayed pruned through every later
    deploy — their rendered text had not changed, so the patch was empty. While
    `.Values.seedCatalog` is true the chart therefore OWNS the seeded recipes and
    re-asserts them each deploy (an operator who wants the UI to own them sets it
    false; per-repo override recipes are separate objects and untouched)
    (`resource-policy: keep`) and templates the sink URL / API URL / namespace /
    image / LLM-credential key from helm values (no sentinel leaks). An agent recipe
    declares exactly ONE LLM credential — `.Values.agentLlmSecretKey` as both the
    `agent-secrets` key and the env var the pod sees — because the controller renders
    each declared secret as a non-optional `secretKeyRef`: a second, absent key would
    fail every run pod at container creation rather than acting as a fallback. GKE
    supplies `ANTHROPIC_API_KEY` (the values.yaml default), a laptop minikube supplies
    `CLAUDE_CODE_OAUTH_TOKEN`, and the `claude` CLI accepts either from its
    environment. ([validated by station catalog tests](apps/floor/src/jobs/agent/agent-catalog.test.ts#L233), [`agent-catalog.test.ts:20`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L20), [`agent-catalog.test.ts:62`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L62), [`agent-catalog.test.ts:80`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L80), [`agent-catalog.test.ts:112`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L112), [`agent-catalog.test.ts:120`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L120), [`agent-catalog.test.ts:148`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L148), [`agent-catalog.test.ts:156`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L156), [`agent-catalog.test.ts:174`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L174), [`agent-catalog.test.ts:186`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L186), [`agent-catalog.test.ts:182`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L182), [`agent-catalog.test.ts:190`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L190), [`agent-catalog.test.ts:199`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L199), [`agent-catalog.test.ts:216`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L216), [`agent-catalog.test.ts:220`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L220), [`agent-catalog.test.ts:233`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L233), [`agent-catalog.test.ts:266`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L266), [`agent-catalog.test.ts:333`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L333), [`agent-catalog.test.ts:348`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L348))

21. Custom station images honor [station-contract.md](../6-dark-factory/contracts/station-contract.md).

22. The `lore-station` image runs one module per non-agent node type, each reading the Floor's
    `station_input` JSON (`parseStationInput`: params default empty, a null `task_id` allowed for
    detection runs, throwing on malformed input or missing required fields): `validate` reports
    `success` with a no-tooling `Lore-Validation: none` extra on an empty repo, `gate` echoes the
    `condition_ref` (`none` when absent), `github_action` times out to `failed` after its CI poll
    budget, and `detect` dispatches by `job_ref` returning the detector's capped summary (throwing on
    an unknown `job_ref`). ([validated by `validate.test.ts:39`](apps/lore-station/src/stations/validate.test.ts#L39), [`stations.test.ts:18`](apps/lore-station/src/stations/stations.test.ts#L18), [`stations.test.ts:40`](apps/lore-station/src/stations/stations.test.ts#L40), [`stations.test.ts:61`](apps/lore-station/src/stations/stations.test.ts#L61), [`stations.test.ts:78`](apps/lore-station/src/stations/stations.test.ts#L78), [`station-input.test.ts:23`](libs/shared/src/station-input.test.ts#L23), [`station-input.test.ts:35`](libs/shared/src/station-input.test.ts#L35), [`station-input.test.ts:50`](libs/shared/src/station-input.test.ts#L50), [`station-input.test.ts:67`](libs/shared/src/station-input.test.ts#L67), [`station-input.test.ts:75`](libs/shared/src/station-input.test.ts#L75), [`station-input.test.ts:83`](libs/shared/src/station-input.test.ts#L83), [`station-input.test.ts:98`](libs/shared/src/station-input.test.ts#L98), [`station-input.test.ts:117`](libs/shared/src/station-input.test.ts#L117))

23. *(added 2026-07-31)* A station that makes its own LLM calls (comment-triage today) MUST report
    their usage for cost accounting despite having no Postgres (D7): the node result carries the
    call's usage, `resultLine` lifts it onto the terminal line as the claude-style fields the
    `/api/agent-events` cost sink already reads (`usage` + `total_cost_usd` + `duration_ms` +
    `model`), and the sink maps that line to a `pipeline.llm_calls` row correlated to the
    assembly-line attempt via the CR name — which is how the run list's Cost column covers
    station-only lines. The usage rides the envelope only, never the `LORE_NODE_RESULT` payload; a
    usage-less terminal line stays byte-identical to the pre-usage envelope, and a failed
    classification reports no usage. ([validated by `agent-output.test.ts:354`](libs/assembly-lines/src/agent-output.test.ts#L354), [`agent-output.test.ts:369`](libs/assembly-lines/src/agent-output.test.ts#L369), [`agent-output.test.ts:380`](libs/assembly-lines/src/agent-output.test.ts#L380), [`agent-events.test.ts:160`](apps/floor/src/jobs/agent/agent-events.test.ts#L162), [`agent-events.test.ts:193`](apps/floor/src/jobs/agent/agent-events.test.ts#L196), [`comment-triage.test.ts:51`](apps/lore-station/src/stations/comment-triage.test.ts#L51), [`comment-triage.test.ts:49`](libs/shared/src/review/comment-triage.test.ts#L49), [`comment-triage.test.ts:71`](libs/shared/src/review/comment-triage.test.ts#L71); implemented by [`agent-output.ts:180`](libs/assembly-lines/src/agent-output.ts#L180))

24. *(added 2026-07-31)* Station LLM usage is captured **generically**: `runStation` wraps the
    process-wide `Llm` in a usage-tracking decorator around every runner, so a station whose model
    calls happen too deep to thread a `NodeResult.usage` by hand (the detect family's
    spec-coverage-backfill judge inside `@re-cinq/lore-shared/detect`) still reports the summed
    spend on its terminal line. An explicit `NodeResult.usage` wins over the tracker's sum; an
    infrastructure-failure line still carries the spend made before the throw; a runner that makes
    no model calls emits the usage-less envelope unchanged; and the wrapped provider is restored
    after the run. The two cost transports are code-enforced exclusive: when the process has a
    configured UsagePort (`Llm.usageConfigured` — the per-call transport), `runStation` installs no
    tracker and suppresses all terminal-line usage, explicit `NodeResult.usage` included, so the
    same call is never counted by both. ([validated by `main.test.ts:22`](apps/lore-station/src/main.test.ts#L22), [`main.test.ts:56`](apps/lore-station/src/main.test.ts#L56), [`main.test.ts:89`](apps/lore-station/src/main.test.ts#L89), [`main.test.ts:113`](apps/lore-station/src/main.test.ts#L113), [`main.test.ts:128`](apps/lore-station/src/main.test.ts#L128), [`main.test.ts:142`](apps/lore-station/src/main.test.ts#L142); implemented by [`llm-usage-tracker.ts:17`](apps/lore-station/src/llm-usage-tracker.ts#L17))

25. *(added 2026-08-03, #1026)* `HttpContextSource.assemble` (D5 hydration) is fail-soft but never
    silent: it returns undefined without fetching when the API is unconfigured, returns the
    assembled text on success, sends the bearer header when a token is configured, and bounds the
    fetch with a 15s `AbortSignal.timeout`; a non-ok response, a fetch/timeout error, a malformed
    2xx body, or an empty, whitespace-only, or absent `text` each yield undefined (the agent runs
    cold) after a `console.warn` carrying the HTTP status or error message plus the repo and query
    ([validated by `http-context-source.test.ts:33`](apps/floor/src/jobs/station/http-context-source.test.ts#L33), [`http-context-source.test.ts:44`](apps/floor/src/jobs/station/http-context-source.test.ts#L44), [`http-context-source.test.ts:60`](apps/floor/src/jobs/station/http-context-source.test.ts#L60), [`http-context-source.test.ts:77`](apps/floor/src/jobs/station/http-context-source.test.ts#L77), [`http-context-source.test.ts:89`](apps/floor/src/jobs/station/http-context-source.test.ts#L89), [`http-context-source.test.ts:106`](apps/floor/src/jobs/station/http-context-source.test.ts#L106), [`http-context-source.test.ts:121`](apps/floor/src/jobs/station/http-context-source.test.ts#L121), [`http-context-source.test.ts:136`](apps/floor/src/jobs/station/http-context-source.test.ts#L136), [`http-context-source.test.ts:147`](apps/floor/src/jobs/station/http-context-source.test.ts#L147), [`http-context-source.test.ts:158`](apps/floor/src/jobs/station/http-context-source.test.ts#L158), [`http-context-source.test.ts:169`](apps/floor/src/jobs/station/http-context-source.test.ts#L169); implemented by [`http-context-source.ts:28`](apps/floor/src/jobs/station/http-context-source.ts#L28))

26. *(added 2026-08-10)* A seeded recipe MUST NOT declare `skills` without a
    `skills_source` to fetch them from. The generated catalog omits the whole skills
    block when the registry URL (`.Values.loreSkillsUrl`) is unset, exactly as it
    already does for `mcp_servers`. Rendering the pair as `skills: [...]` beside
    `skills_source: null` is not the harmless no-op it was assumed to be: the
    subsystem's init runs its skills step, fetches nothing, reports **success**, and
    the agent container then dies with `Settings file not found:
    $HOME/.claude/settings.json` — the file that step fetches from
    `<source>/settings.json`. A laptop minikube therefore points the value at the mcp
    adapter running in HTTP-gateway mode on the host
    (`http://host.minikube.internal:3002/skills`, served by `npm start`) rather than
    leaving it empty ([validated by `agent-catalog.test.ts:204`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L204); implemented by [`agent-catalog.ts:363`](apps/floor/src/jobs/agent/agent-catalog.ts#L363))

27. *(added 2026-08-10)* The agent container MUST run in the cloned repo
    (`/workspace/target`), not the base image's default directory. Left unset, the
    container inherits `/`, which is not writable — so the one instruction every
    agent prompt gives about its deliverable ("write `result.json` in the working
    directory") is unsatisfiable. A feature-planning agent produced a complete
    16 KB GapResult, failed to place it (`cp: cannot create regular file
    '/result.json': Permission denied`), wrote it to `$HOME` instead, and exited 0 —
    so the run reported success while the round it existed for failed with no result
    posted. Read-only recipes (the review family) opt out via `repo_workdir: false` —
    see statement 31 (#1160)
    ([validated by `agent-catalog.test.ts:138`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L138); implemented by [`agent-catalog.ts:211`](apps/floor/src/jobs/agent/agent-catalog.ts#L211))

28. *(added 2026-08-10)* A run whose deliverable is a **file** MUST declare it, so the
    artifact can leave the pod. The subsystem streams what an agent *says*
    ([ai-agent-subsystem#188](https://github.com/re-cinq/ai-agent-subsystem/issues/188)),
    so a recipe declares `output.watch: [{event, path}]`; once the agent exits the
    supervisor raises a named `{"kind":"file"}` event carrying the contents on the
    same NDJSON sink the Floor already receives, and the Floor — which holds the
    database — performs the write. No API token in the pod, and no LLM in the
    delivery path. `feature-planning` declares `planning.result` →
    `target/result.json`; the path resolves against `WORKSPACE_DIR`, not the agent's
    cwd. A recipe whose deliverable is its own output declares nothing
    ([validated by `agent-catalog.test.ts:94`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L94), [`agent-catalog.test.ts:105`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L105); implemented by [`agent-catalog.ts:173`](apps/floor/src/jobs/agent/agent-catalog.ts#L173))

29. *(added 2026-08-10)* The Floor MUST project those artifact events off the
    telemetry sink. The sink carries every run's events, so a file event with no name
    (nothing could route it) or no task attribution (nothing to act on) is skipped
    exactly like an uncorrelated cost row ([validated by `agent-events.test.ts:203`](apps/floor/src/jobs/agent/agent-events.test.ts#L206), [`agent-events.test.ts:225`](apps/floor/src/jobs/agent/agent-events.test.ts#L228), [`agent-events.test.ts:238`](apps/floor/src/jobs/agent/agent-events.test.ts#L241), [`agent-events.test.ts:247`](apps/floor/src/jobs/agent/agent-events.test.ts#L250), [`agent-events.test.ts:261`](apps/floor/src/jobs/agent/agent-events.test.ts#L264), [`agent-events.test.ts:274`](apps/floor/src/jobs/agent/agent-events.test.ts#L277); implemented by [`agent-events.ts:96`](apps/floor/src/jobs/agent/agent-events.ts#L96))

30. *(added 2026-08-10)* Settling a round from an artifact event is skip-not-fail: an
    artifact raised under another event name, a task that is not a planning round, and
    a task that no longer exists are each a no-op, and a delivery that throws must not
    500 an ingest carrying cost and run-viz rows for unrelated runs ([validated by `planning-result.test.ts:64`](apps/floor/src/jobs/agent/planning-result.test.ts#L64), [`planning-result.test.ts:75`](apps/floor/src/jobs/agent/planning-result.test.ts#L75), [`planning-result.test.ts:86`](apps/floor/src/jobs/agent/planning-result.test.ts#L75), [`planning-result.test.ts:99`](apps/floor/src/jobs/agent/planning-result.test.ts#L109), [`planning-result.test.ts:110`](apps/floor/src/jobs/agent/planning-result.test.ts#L120), [`planning-result.test.ts:130`](apps/floor/src/jobs/agent/planning-result.test.ts#L141), [`planning-result.test.ts:143`](apps/floor/src/jobs/agent/planning-result.test.ts#L155), [`planning-result.test.ts:153`](apps/floor/src/jobs/agent/planning-result.test.ts#L165); implemented by [`planning-result.ts:44`](apps/floor/src/jobs/agent/planning-result.ts#L44))

31. *(added 2026-08-13)* The review family's recipes (`review`, `code-review`,
    `code-review-recheck`, `code-review-refine`) are read-only toward the checkout:
    they MUST NOT install dependencies or build in it. GKE Autopilot caps a pod that
    declares no ephemeral-storage at 1Gi, and one `npm ci` in the clone exceeds it
    and evicts the pod mid-review ([#1160](https://github.com/re-cinq/lore/issues/1160)).
    Three layers: the prompts state the rule and the disk budget; the family drops
    the container `workingDir` via `repo_workdir: false`, so the pod is not started
    inside the checkout it is only meant to read (the posture that held from #783
    until #1141); and package-manager/build commands are declared in the recipe's
    `disallowed_tools` — appended after the base pipeline-tool deny, a recipe that
    declares none keeps the base deny alone. The declared denies are dormant under
    the current `permission_mode: "bypass"` (the CLI skips deny-rule evaluation in
    that mode) and become enforced when the family moves to an enforcing mode
    ([validated by `agent-catalog.test.ts:371`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L371), [`agent-catalog.test.ts:381`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L381), [`agent-catalog.test.ts:387`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L387); implemented by [`agent-catalog.ts:166`](apps/floor/src/jobs/agent/agent-catalog.ts#L166), [`agent-catalog.ts:209`](apps/floor/src/jobs/agent/agent-catalog.ts#L209))

## Out of scope

- `feature-decompose` stays in-process (no pod) and is not migrated. *(graph-ingest was also out of
  scope here, but the whole `internal.ingest.*` family has since moved onto detect-shaped assembly
  lines with an `ingest` station — see `specs/ingest-station/`; no in-process dgraph writer remains.)*
- The `StationDefinition` Postgres record and compute sizing (ADR-030 §5 follow-up) — the Station's
  `PodTemplateSpec` already carries image/compute.

## Watcher, worker & CR-watch — validated behavior

These statements pin the deterministic Floor glue that wraps the subsystem.

- **Cluster credential resolution.** Every Kubernetes client the Floor and lore-api construct
  loads credentials through `loadKube`: the in-cluster pod service account when
  `KUBERNETES_SERVICE_HOST` is present, else the explicit `LORE_KUBECONFIG` override, else the
  ambient default (`KUBECONFIG`, then `~/.kube/config`). In-cluster wins over the override, so a
  stray `LORE_KUBECONFIG` in a pod env can never repoint a deployed process; the override exists so
  a developer's host-run Floor can drive a laptop minikube
  (`runbooks/floor-assembly-run-minikube-smoke.md`). ([validated by `kube-config.test.ts:25`](libs/shared/src/kube-config.test.ts#L25), [`kube-config.test.ts:31`](libs/shared/src/kube-config.test.ts#L31), [`kube-config.test.ts:37`](libs/shared/src/kube-config.test.ts#L37), [`kube-config.test.ts:41`](libs/shared/src/kube-config.test.ts#L41), [`kube-config.test.ts:50`](libs/shared/src/kube-config.test.ts#L50), [`kube-config.test.ts:58`](libs/shared/src/kube-config.test.ts#L58), [`kube-config.test.ts:66`](libs/shared/src/kube-config.test.ts#L66), [`kube-config.test.ts:74`](libs/shared/src/kube-config.test.ts#L74))
- **One namespace default.** The namespace Agent CRs live in is
  `LORE_AGENTS_NAMESPACE`, falling back to `ai-agents`. The rule is resolved in one place rather than
  at each construction site: it had been restated eight times across the Floor and lore-api, and a
  default written eight times is a default that drifts in seven of them.
  ([validated by returns ai-agents when LORE_AGENTS_NAMESPACE is unset](libs/shared/src/kube-config.test.ts#L84), [`kube-config.test.ts:88`](libs/shared/src/kube-config.test.ts#L88))
- **Pending-task single-flight.** The Floor worker's `pollWithGuard` claims and processes one task
  per tick, does nothing when there is no runnable task, and skips a concurrent tick while a task is
  still processing (only one claim in flight). ([validated by `worker.poll.test.ts:5`](apps/floor/src/jobs/task/worker.poll.test.ts#L5), [`worker.poll.test.ts:17`](apps/floor/src/jobs/task/worker.poll.test.ts#L17), [`worker.poll.test.ts:29`](apps/floor/src/jobs/task/worker.poll.test.ts#L29))
- **CR-watch event mapping.** `mapAgentToEvent` maps a terminal `Agent` CR to
  `kubernetes.agent.{succeeded,failed}` keyed on task-id+phase, and an assembly-line node CR to
  `kubernetes.agent_node.{succeeded,failed}` deduped per CR name (carrying the node iteration) so two
  node CRs of one line dedupe separately (the swallowed-second-node regression); it returns null for a
  non-terminal phase and when the task-id label is absent. ([validated by `k8s-map.test.ts:39`](apps/floor/src/listeners/k8s-map.test.ts#L75), [`k8s-map.test.ts:57`](apps/floor/src/listeners/k8s-map.test.ts#L93), [`k8s-map.test.ts:64`](apps/floor/src/listeners/k8s-map.test.ts#L100), [`k8s-map.test.ts:87`](apps/floor/src/listeners/k8s-map.test.ts#L123), [`k8s-map.test.ts:101`](apps/floor/src/listeners/k8s-map.test.ts#L137), [`k8s-map.test.ts:113`](apps/floor/src/listeners/k8s-map.test.ts#L149), [`k8s-map.test.ts:122`](apps/floor/src/listeners/k8s-map.test.ts#L158))
- **Paginated CR listing.** The reconcile safety net and the watch catch-up walk the Agent CRs
  one bounded page at a time (threading the API's `continue` token and returning the list
  `resourceVersion` for watch seeding) instead of one unpaginated LIST — a namespace-sized
  response must never be held or parsed whole, because an accumulated CR pile OOMs the single
  512Mi Floor replica and, since the age-based pruner runs inside this same pass, the pile can
  then never shrink again (2026-07-24 crash loop). Per-page processing keeps the emit gating
  (task/line still in flight) and the prune-after-an-hour behavior unchanged. ([validated by `k8s-watch-pagination.test.ts:56`](apps/floor/src/listeners/k8s-watch-pagination.test.ts#L56), [`k8s-watch-pagination.test.ts:77`](apps/floor/src/listeners/k8s-watch-pagination.test.ts#L77), [`k8s-watch-pagination.test.ts:94`](apps/floor/src/listeners/k8s-watch-pagination.test.ts#L94), [`k8s-watch-pagination.test.ts:112`](apps/floor/src/listeners/k8s-watch-pagination.test.ts#L112))
- **Run-outcome mapping.** `runOutcomeFromTaskStatus` records the watcher's run outcome: `pr-created`
  and `review` → `pr_created`; `failed` and `needs-human-help` → `failed`; `completed` → `completed`;
  an un-advanced task on a `Failed` CR maps to `failed` (not completed) while a `Succeeded` CR maps to
  `completed`. ([validated by `agent-watcher-logic.test.ts:89`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L89), [`agent-watcher-logic.test.ts:93`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L93), [`agent-watcher-logic.test.ts:97`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L97), [`agent-watcher-logic.test.ts:78`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L78), [`agent-watcher-logic.test.ts:100`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L100), [`agent-watcher-logic.test.ts:106`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L106))
- **Issue-body log links.** `taskPageUrl` builds the web-ui task-page link (`{LORE_UI_URL}/tasks/{taskId}`,
  trailing slashes stripped) that the watcher embeds as the "See [logs](…)" copy in Lore-managed issue
  bodies — the task page's log viewer is the canonical surface, replacing the browser-unclickable
  `gs://` object URL (#1294). When no UI base URL is configured it returns undefined and the copy
  degrades to plain "See logs" rather than fabricating a dead link. ([validated by `agent-watcher-logic.test.ts:150`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L150), [`agent-watcher-logic.test.ts:156`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L156), [`agent-watcher-logic.test.ts:162`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L162), [`agent-watcher-logic.test.ts:166`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L166))
- **Station failure diagnostic.** When a station CR fails, `stationLogTail` surfaces the tail of the
  pod output where the git/clone error lives: it drops blank lines, bounds to the last `maxLines`, and
  returns empty for empty output. ([validated by `finalize-station-run.test.ts:5`](apps/floor/src/jobs/task/finalize-station-run.test.ts#L5), [`finalize-station-run.test.ts:18`](apps/floor/src/jobs/task/finalize-station-run.test.ts#L18), [`finalize-station-run.test.ts:22`](apps/floor/src/jobs/task/finalize-station-run.test.ts#L22))
- **Agent pod-log retrieval.** `readAgentLogs` resolves an Agent CR's newest job pod and returns its
  (tail-bounded) logs, or `available:false` with a reason — `no-agent` (CR gone), `no-job` (no
  jobName yet), `no-pod` (pod GC-ed with nothing retained in the durable archive, including a 404
  during the read) — rethrowing a non-404
  Kubernetes error (RBAC 403); `podSelectorForJob` builds the `job-name` selector and `pickLatestPod`
  picks the newest by `creationTimestamp` (null on empty). The `GET /api/agent-logs/{name}` route
  serves it behind the ingest bearer (401 on mismatch), and `parseTail` caps an over-large tail at
  50 000, keeps a sane value, and defaults non-positive/non-numeric input. ([validated by `agent-pod-logs.test.ts:59`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L59), [`agent-pod-logs.test.ts:67`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L67), [`agent-pod-logs.test.ts:71`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L71), [`agent-pod-logs.test.ts:86`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L86), [`agent-pod-logs.test.ts:107`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L107), [`agent-pod-logs.test.ts:115`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L115), [`agent-pod-logs.test.ts:131`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L131), [`agent-pod-logs.test.ts:147`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L147), [`agent-pod-logs.test.ts:165`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L165), [`agent-pod-logs.test.ts:181`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L181), [`agent-logs.test.ts:39`](apps/floor/src/delivery/http/routes/agent-logs.test.ts#L39), [`agent-logs.test.ts:50`](apps/floor/src/delivery/http/routes/agent-logs.test.ts#L50), [`agent-logs.test.ts:67`](apps/floor/src/delivery/http/routes/agent-logs.test.ts#L67), [`agent-logs.test.ts:81`](apps/floor/src/delivery/http/routes/agent-logs.test.ts#L81), [`agent-logs.test.ts:85`](apps/floor/src/delivery/http/routes/agent-logs.test.ts#L85), [`agent-logs.test.ts:89`](apps/floor/src/delivery/http/routes/agent-logs.test.ts#L89))
- **Durable pod-log fallback.** When the live pod is gone, `readAgentLogs` consults a `PodLogArchive`
  (`CloudLoggingPodLogs`, backed by the Cloud Logging `_Default` bucket) before giving up: retained
  stdout is served as `archived` logs — whether the pod list is empty or a 404 hits during the read —
  and only an empty archive falls through to `no-pod`; the tail bound is forwarded and a live pod is
  never overridden. `entryText` reads a `textPayload`, else `jsonPayload.message`, else the JSON
  payload; `podLogFilter` composes the `k8s_container`/namespace/`job-name` filter; `assembleArchivedLog`
  reverses the newest-first entries into chronological text (null when empty). ([validated by `agent-pod-logs.test.ts:200`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L200), [`agent-pod-logs.test.ts:217`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L217), [`agent-pod-logs.test.ts:239`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L239), [`agent-pod-logs.test.ts:252`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L252), [`agent-pod-logs.test.ts:261`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L261), [`agent-pod-logs.test.ts:281`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L281), [`agent-pod-logs.test.ts:287`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L287), [`agent-pod-logs.test.ts:293`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L293), [`agent-pod-logs.test.ts:299`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L299), [`agent-pod-logs.test.ts:305`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L305), [`agent-pod-logs.test.ts:309`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L309), [`agent-pod-logs.test.ts:321`](apps/floor/src/jobs/station/agent-pod-logs.test.ts#L321))
- **Silent-500 guard.** The Floor's HTTP server logs every boomified handler or auth-scheme throw
  on the hapi `request` error channel with method, path, request id, and stack under an `[http]`
  tag, so no route 500s anonymously (the #1319 outage was undiagnosable for exactly that reason).
  Deliberate Boom 4xx/503 responses do not hit the channel and are unchanged. ([validated by `agent-logs.test.ts:97`](apps/floor/src/delivery/http/routes/agent-logs.test.ts#L97))
- **Recipe → CRD materialisation.** `agentDefToCrds` maps an `AgentDefinition` recipe to a paired
  Kubernetes `AgentDefinition` + `Station`: an AI recipe carries `permission_mode:"bypass"`,
  `max_turns:40`, a `{context}`-suffixed prompt, and — when an events URL is supplied — the http
  telemetry sink alongside stdout; model is omitted when the recipe inherits it, a recipe with no
  prompt is rejected outright (the subsystem refuses a promptless AgentDefinition at admission, so
  emitting one only moved the failure to the apply), deadline defaults to 30 and image to
  `node:22-bookworm`, and stdout-only sinks stand in without an events URL. An `execution_mode:"station"` recipe materialises an exec-vendor station (`model:"exec"`,
  `{station_input}` prompt, `max_turns:1`, `lore-station <type>` command) on its own image. ([validated by `agent-crd.test.ts:17`](apps/lore-api/src/features/agents/agent-crd.test.ts#L17), [`agent-crd.test.ts:58`](apps/lore-api/src/features/agents/agent-crd.test.ts#L60), [`agent-crd.test.ts:78`](apps/lore-api/src/features/agents/agent-crd.test.ts#L132), [`agent-crd.test.ts:86`](apps/lore-api/src/features/agents/agent-crd.test.ts#L140))
- **CR-watch idempotency.** Event dedupe keys collapse redundant deliveries so a Floor restart replays
  nothing twice: `githubDedupeKey` prefixes the delivery id, `k8sDedupeKey` keys a terminal Agent CR
  on task-id+phase (repeated `MODIFIED` events collapse), `cronDedupeKey` floors the tick to the
  minute (a restart replay collapses with the normal tick; distinct minutes stay distinct); the
  `kubernetes.agent` handler treats a 404 on the CR GET as already-pruned (no processing, no throw)
  and rethrows a 403 so the loop retries rather than marking it handled. ([validated by `dedupe.test.ts:5`](apps/floor/src/main-loop/dedupe.test.ts#L5), [`dedupe.test.ts:11`](apps/floor/src/main-loop/dedupe.test.ts#L11), [`dedupe.test.ts:17`](apps/floor/src/main-loop/dedupe.test.ts#L17), [`dedupe.test.ts:23`](apps/floor/src/main-loop/dedupe.test.ts#L23), [`kubernetes.test.ts:22`](apps/floor/src/jobs/kubernetes.test.ts#L22), [`kubernetes.test.ts:30`](apps/floor/src/jobs/kubernetes.test.ts#L30))
