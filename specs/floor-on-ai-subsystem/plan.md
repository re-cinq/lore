# Implementation Plan: Floor on the ai-agent-subsystem

Tracks epic [#690](https://github.com/re-cinq/lore/issues/690). One PR per ticket, **in order**, each
merged before the next starts.

## Per-PR discipline (every ticket)

- **Branch** off latest `main`: `feat/<slug>` (`docs/<slug>` for docs-only tickets).
- **TDD** — failing test first → minimal implementation → refactor; colocated `*.test.ts`; **real
  values, no mocks** (the No-LLM guard is global). Isolate IO (k8s client, Octokit, fs, network)
  behind ports so the pure decision logic is fully testable.
- **100% coverage, machine-enforced, scoped to the PR's new files** — add the new files to a vitest
  v8 `coverage.include` with `thresholds: 100` and wire `npm run test:coverage -w <pkg>` into
  `.github/workflows/test.yml`. Thin IO adapters are excluded from the glob (documented in-config).
  Legacy code is not retroactively gated. Docs/infra-only PRs: coverage N/A → unit-test pure
  helpers/generators + Helm `template` render assertions.
- **PR** via `/lore-pr` (template: Why / Approach / Alternatives rejected / ADR references / Spec),
  body ending with **`Closes #<n>`** and **`Part of #690`**; conventional-commit title; Co-Authored-By
  trailer.

## Phases

**Foundation**
1. **#681** — Rewrite ADR-031 + this spec. *(this PR)*
2. **#82** *(subsystem)* — Generate `@re-cinq/agent-contracts` from the D structs; cut **v0.3.0**
   (images + npm package).
3. **#682** — Deploy the subsystem via a Helm chart in the existing `terraform apply` (CRDs +
   controller + RBAC + NetworkPolicy + ESO `agent-secrets` from existing remoteRefs).

**Wave 1 — single-Agent task types**
4. **#683** — `AgentBackend` (creates `Agent` CRs) + pure `decideExecutionBackend` two-gate router.
5. **#684** — Floor-side `agent-watcher` (changed files, CI gate, PR, auto-merge, escalation).
6. **#685** — UI-authored CRD catalog (edit YAML → apply to k8s; seed from current setup) + context
   hydration + per-task GitHub token.
7. **#687** — Observability: `POST /api/agent-events` NDJSON sink → `pipeline.llm_calls`/OTEL/GCS/UI.

**Wave 2 — multi-node graph**
8. **#686** — Floor-side `executeGraph`: `createAgentNodeHandler` + the `github-action` node type +
   lease heartbeat.

**Finish**
9. **#688** — Graded cutover flag + LoreTask teardown (reversible; LoreTask retired last).
10. **#689** — Strip LoreTask references from `adrs/` + `specs/`.

> Sequencing note: #82 lands right after the spec because #683/#684/#685 import
> `@re-cinq/agent-contracts`. #687 (independent infra) precedes the hard Wave-2 graph (#686).

## Verification

- Per package: `npm test -w <pkg>` then `npm run test:coverage -w <pkg>` → 100% on the scoped
  `include`; `npm run typecheck:drift`; `/pre-push`. Build `shared`→`runner` before dependents.
- CI: `.github/workflows/test.yml` matrix green incl. the new coverage job.
- Subsystem #82: `dub test` + the new TS package `vitest --coverage`; tag `v0.3.0` publishes signed
  images + `@re-cinq/agent-contracts@0.3.0`.
