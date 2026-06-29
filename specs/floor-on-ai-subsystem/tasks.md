# Tasks: Floor on the ai-agent-subsystem

One PR per task, in order, each merged before the next. Every PR: TDD, 100% coverage on new code
(scoped, machine-enforced), and `Closes #<n>` + `Part of #690`.

> **Status (as-built):** the cutover is code-complete. #681–#687, #686, and #689 are merged.
> #731 then went all-in early — it deleted the `RoutingStationBackend` cutover router and the
> per-repo `execution.backend` gate (no graded ramp) and tore the `loretask-crd` module,
> `claude-runner` image, and LoreTask RBAC out of terraform. So #688's router + teardown are
> effectively done; only the live GKE deploy soak (operator) keeps the issue open.

## Foundation
- [x] **#681** `docs/adr-031-cutover` — rewrite `adrs/ADR-031`, banner `adrs/ADR-030`, write
  `specs/floor-on-ai-subsystem/{spec,plan,tasks}.md`. *(docs — coverage N/A)* — **AC 1**
- [x] **#82** *(subsystem)* `feat/agent-contracts-v0.3.0` — D generator (mirrors `crdgen`) →
  `@re-cinq/agent-contracts`; v0.3.0 tag + CHANGELOG + npm publish. *(D `unittest` + TS vitest 100%)*
  — **AC 2** — depends on #681
- [x] **#682** `feat/ai-agents-helm` — `terraform/modules/gke-mcp/ai-agents-helm/` + `infra/terraform`
  + ESO/RBAC. *(Helm render tests; pure seed helper 100%)* — **AC 3** — depends on #681

## Wave 1 — single-Agent task types
- [x] **#683** `feat/agent-backend` — `apps/floor/src/adapters/agent-cr-backend.ts`,
  `decideExecutionBackend`, `project-boot.ts`. *(vitest 100% scoped)* — **AC 4, 5** — depends on #82
- [x] **#684** `feat/agent-watcher` — `apps/floor/.../scheduled/agent-watcher.ts`.
  *(vitest 100% scoped)* — **AC 6, 7** — depends on #683
- [x] **#685** `feat/catalog-ui-token` — `apps/floor` + `apps/web-ui` `/agents` editor + terraform
  seed. *(vitest 100% scoped)* — **AC 8, 9** — depends on #82, #682, #683
- [x] **#687** `feat/agent-events-sink` — `apps/floor` `POST /api/agent-events`.
  *(vitest 100% scoped)* — **AC 10** — depends on #682

## Wave 2 — multi-node graph
- [x] **#686** `feat/workflow-graph-agent-nodes` — `libs/runner/src/agent-node-handler.ts`,
  `github-action` node + loader, `apps/floor/orchestrator.ts`. *(vitest 100% scoped)* — **AC 11, 12**
  — depends on #684, #685

## Finish
- [ ] **#688** `feat/cutover-teardown` — graded-rollout pure fn + terraform teardown.
  Router + teardown shipped (superseded by #731's all-in removal); **remaining: the live GKE deploy
  soak** per `runbooks/floor-graph-gke-cutover.md`. *(vitest 100% scoped on rollout logic)*
  — **AC 13** — depends on all
- [x] **#689** `docs/strip-loretask` — `adrs/` superseded banners + `specs/` LoreTask → past tense.
  *(docs — coverage N/A)* — **AC 14** — depends on #688

## Never migrated (stay in-process, no pod)
- `feature-decompose`, `graph-ingest`
