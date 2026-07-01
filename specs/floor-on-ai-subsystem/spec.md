# Feature Specification: Floor task execution on the ai-agent-subsystem

| Field          | Value                                                                 |
|----------------|-----------------------------------------------------------------------|
| Feature        | Floor → ai-agent-subsystem cutover (retire LoreTask)                  |
| Status         | **Draft**                                                             |
| Created        | 2026-06-25                                                            |
| Owner          | Platform Engineering                                                  |
| ADR            | [`ADR-031`](../../adrs/ADR-031-agent-station-crds.md) (supersedes ADR-011 + ADR-030 storage) |
| Epic           | [#690](https://github.com/re-cinq/lore/issues/690)                   |
| Subsystem      | [`re-cinq/ai-agent-subsystem`](https://github.com/re-cinq/ai-agent-subsystem) (`agents.re-cinq.com` / `ai-agents`) |

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
workflows.

We want all Floor task execution to run on that subsystem and to retire the LoreTask path — without
losing any of Lore's deterministic guarantees.

## Solution

Make the `ai-agent-subsystem` the **production execution substrate** and turn the **Floor into the
orchestrator** that wraps it. The subsystem's CRDs (`AgentDefinition` / `Station` / `Agent`,
`agents.re-cinq.com`) are the **source of truth**, edited via the web UI which applies YAML to the
cluster. The Lore-specific glue is **relocated Floor-side** and stays deterministic:

- A new **`AgentBackend`** (the existing `StationBackend` port) creates `Agent` CRs instead of
  `LoreTask` CRs; a two-gate flag routes tasks during a graded, reversible cutover.
- A Floor-side **`agent-watcher`** (replacing `loretask-watcher`) computes changed files, reads the
  **GitHub Actions** CI gate, opens the PR (`Lore-Task` footer), auto-merges, and escalates.
- The **assembly line** (`libs/runner` `executeAssemblyLine`) runs in the Floor; AI nodes dispatch `Agent`
  CRs, **non-AI nodes reference the repo's GitHub Actions**, and the lease is heartbeated while a
  node runs.
- The recipe **schema + client are generated from the subsystem's D structs** into a published
  code-API package (`@re-cinq/agent-contracts`, subsystem v0.3.0) that the Floor and UI import.
- Secrets, context hydration, networking, and observability **reuse the existing setup** (ESO
  remoteRefs, public-LB hydration, an NDJSON http sink into `pipeline.llm_calls`/OTEL/GCS).

The cutover is reversible (both controllers run in parallel behind a flag); `LoreTask`, the
`claude-runner` image, and the cluster-wide `loretask-agent` RBAC are torn down only after a soak.

### Design decisions (locked) — D1–D8 (see ADR-031)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **D1** Substrate | Production runs on the **D standalone** `ai-agent-subsystem` (`agents.re-cinq.com` / `ai-agents`); the in-tree TS `k8s/` PoC is **deleted** | One signed, mature substrate; no two half-built copies |
| **D2** Source of truth | The **CRDs are authoritative**; the web UI edits YAML → applies to k8s; ADR-030's Postgres recipe store retired; schema + client **generated from D** into `@re-cinq/agent-contracts` | The cluster object is the truth; the contract can't drift |
| **D3** Validation | Non-AI workflow steps **reference GitHub Actions**; the Floor gates on the run **conclusion** | The engine runs `claude` directly; GitHub runs the repo's real toolchain — deterministic, no toolchain in the Floor |
| **D4** Assembly line | `executeAssemblyLine` runs **Floor-side**; an agent-node dispatches one `Agent` CR + awaits status; **lease heartbeated** while waiting | The assembly-line engine is process-agnostic; lease/resume/`iteration_max` are branch-centric |
| **D5** Context hydration | Floor injects context into `Agent.spec.parameters`; code recipes also wire the Lore MCP server | Turn-1 context, deterministic, no in-pod network dependency |
| **D6** Secrets | **Inherit** the existing GCP Secret Manager remoteRefs via ESO into `agent-secrets`; per-task GitHub App token PATCHed in and removed on terminal | No new secret material; short-lived, least-privilege; no org PAT |
| **D7** Networking | Self-hydration + telemetry over the **public LB**; run pods **drop direct Postgres** | The run-pod NetworkPolicy blocks RFC1918/metadata; DB-less pods shrink blast radius |
| **D8** Observability | NDJSON **http sink → Floor `/api/agent-events`** → `pipeline.llm_calls` + OTEL + GCS + UI logs | No telemetry capability lost; pod stays DB-less and GCS-less |

## Architecture (target data-flow, one `implementation` task)

```
pending task ─► Floor coordinator (executeAssemblyLine in the Floor; branch lease)
  ├─ implement (AI node) ─► AgentBackend creates an Agent CR ─► ai-agent-subsystem controller
  │                          (init clones repo + installs claude) ─► supervisor runs claude --print
  │                          ─► edits + commits (Lore-* trailers) + pushes ─► status: Succeeded
  ├─ validate (non-AI node) ─► reference the repo's GitHub Actions ─► gate on conclusion
  ├─ review / address (AI nodes) ─► more Agent CRs, bounded by iteration_max
  └─ retrospective / merge ─► Floor-side handlers
agent-watcher ─► changed files (compare-commits) ─► CI gate ─► open PR (Lore-Task footer)
              ─► auto-merge / escalate / Slack / episode
http sink ─► Floor /api/agent-events ─► pipeline.llm_calls + OTEL + GCS + UI
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
| `libs/runner/src/agent-node-handler.ts` + `github-action` node | NEW Floor-side graph nodes (#686) |
| `apps/floor` flag + `terraform` | Graded cutover + LoreTask teardown (#688) |
| `adrs/` + `specs/` | LoreTask references retired (#689) |

## Acceptance Criteria

> Each criterion is implemented test-first; as a ticket's tests go green it adds the inline
> `([validated by <name>](path/to/test.ts#Lnn))` link to the criterion it satisfies
> (spec-test-coverage v3). Criteria are un-linked here until their PR lands.

1. ADR-031 is rewritten to make the subsystem the production substrate, recording D1–D8, and
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
   parameters populated, `taskId` label), and resolves activeness by label.
6. A `Succeeded` `Agent` with pushed changes results in a PR carrying the `Lore-Task` footer; an
   `Agent` with no changes completes the task with no PR.
7. The deterministic gate reads the **conclusion of the GitHub Actions referenced by the workflow**:
   a red conclusion routes to the address loop, a green conclusion proceeds.
8. The `/agents` web UI edits an `AgentDefinition`/`Station` and **applies the YAML to Kubernetes**
   with no Postgres write; the Floor reads recipes from the CRDs via `@re-cinq/agent-contracts`.
9. Secrets in `ai-agents` are mirrored from the existing remoteRefs; the per-task GitHub token is
   added before a run, referenced by `token_secret`, and removed on terminal status.
10. Run output reaches the Floor over the public-LB http sink and is recorded in
    `pipeline.llm_calls`, OTEL spans, and GCS (the UI log viewer shows it).
11. `createAgentNodeHandler` maps an `Agent`'s terminal status to a node outcome
    (`success`/`failed`/`changes_requested`); the branch lease is heartbeated across a long node and
    is not reaped while the node runs; a forced Floor restart resumes from the last stage trailer.
12. A `github-action` workflow node dispatches the referenced GitHub Actions run and gates on its
    conclusion.
13. The cutover is reversible: flipping the cluster gate off routes new tasks back to LoreTask with
    no in-flight loss; after the soak, no new `LoreTask` CRs are created for any migrated task type.
14. After teardown, the `loretask-crd` module, the `claude-runner` image build, and the cluster-wide
    `loretask-agent` RBAC are removed; `adrs/` + `specs/` present no LoreTask as the current path.

## Out of scope

- `feature-decompose` and `graph-ingest` stay in-process (no pod) and are not migrated.
- The `StationDefinition` Postgres record and compute sizing (ADR-030 §5 follow-up) — the Station's
  `PodTemplateSpec` already carries image/compute.
