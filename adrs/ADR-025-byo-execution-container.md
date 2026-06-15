---
adr_number: 25
title: "BYO execution container: per-repo/per-task image, Lore-hosted, injected portable kernel"
status: accepted
date: 2026-06-15
domains: [agent, pipeline, infra, security]
---

# ADR-025: Bring-Your-Own execution container

## Context

Every cluster pipeline task runs in a single image Lore builds —
`lore-claude-runner` (Node + Claude Code + the Lore execution kernel). A Go,
Python, or Rust repository runs its task inside that **Node-only** image. The
mandatory post-edit validation stage (`detectTooling` → lint/typecheck, ADR-013)
can therefore only run Node tools: `go vet`, `mypy`/`ruff`, `cargo check` never
execute, so validation is silently a no-op for non-Node repos. The task
environment also diverges from the repo's real build environment.

We want each repo to run its tasks in an image that carries its own toolchain,
without giving up Lore's execution perimeter (in-cluster, non-root,
NetworkPolicy-restricted egress, short-lived per-task tokens). The Station — the
unit that runs one Agent (ADR-024) — should be able to be any image.

## Decision

Adopt **Lore-hosted, Bring-Your-Own image** execution. Execution stays in Lore's
GKE cluster; the repo supplies the container image; Lore injects its execution
kernel into that image at runtime.

**Configuration — a default container, overridable per agent.** "Which image
does this task run in" resolves through a hierarchy (last match wins):

1. **Platform default** — `lore-claude-runner` (the container used by default).
2. **Per-repo** — `settings.execution.image`.
3. **Per-task-type** — `settings.task_overrides.<type>.execution.image`
   (e.g. `implementation` runs in the repo's toolchain image; `gap-fill` stays
   on the default).

The resolved image is written to `LoreTask.spec.image` (the CRD field already
exists). The only user-facing knob is **`image`** — the user's stated need is "a
default container, with custom containers per agent where needed." The *execution
backend* (local / cluster / direct) is already abstracted by the existing
`agents` port and selected by task type; the image is just an attribute of the
cluster path. There is deliberately **no** `backend` user setting and **no** new
`ExecutionBackend` port (YAGNI + DRY — see Architecture).

`execution.image` is a **security boundary** (it controls what code runs and what
secrets that code can read), so changing it is **two-key gated** — admin scope
plus a CODEOWNERS-approved PR — exactly like `dark_factory.enabled`
(ADR-016).

**Mechanism (delivered incrementally; see Consequences):**

- **Reuse the existing `agents` port** (`AgentRunner`,
  `libs/shared/src/project/agents/`) rather than add a parallel
  `ExecutionBackend` port. `AgentRunner.run(mode)` already abstracts the three
  execution backends the earlier design imagined — `local` (claude CLI),
  `cluster` (LoreTask CR), `direct` (LLM API) — so a new port would only
  duplicate it. BYO adds one field: `image` flows
  `AgentRunOpts.image` → `LoreTaskSpec.image` → `CR.spec.image`. The worker
  resolves the image via `resolveExecutionImage` and passes it; everything else
  is unchanged.
- The kernel (`@re-cinq/lore-runner`) is compiled to a self-contained **Node SEA
  (Single Executable Application)** binary so it can run inside an image that has
  no Node. A tiny Lore-owned **`lore-kernel` init container** copies the binary
  into a shared `emptyDir`; the **main container is the repo's image** and runs
  the injected binary. The kernel is already port-based and boundary-enforced —
  only workflow loading (embed the YAMLs) and the lazy `@anthropic-ai/sdk` import
  need adjustment.
- In BYO mode the Agent runs **over the Anthropic API** (`createAgentHandler` +
  `AnthropicProvider`), not the `claude` CLI (which won't exist in a Go/Python
  image). The default image keeps the CLI handler.
- `detectTooling` already runs in the pod's working directory; in the repo's
  image the native toolchain is present, so polyglot validation works.

## Alternatives rejected

- **Customer-hosted execution / remote-CI protocol** — moves execution out of
  Lore's perimeter; loses the in-cluster secret + NetworkPolicy posture and
  complicates token handling. Out of scope; the protocol seam is left open as a
  future `agents` mode.
- **Install every toolchain into `lore-claude-runner`** — an ever-growing image
  that still can't match a repo's exact tool versions; the opposite of BYO.
- **A new `ExecutionBackend` port / `backend` user setting** — speculative and
  duplicative: the existing `agents` port already abstracts the backends, and the
  backend is selected by task type, not a user knob.
- **Bun / Deno compile for the kernel** — Bun is viable but adds a build
  toolchain; Deno isn't Node-compatible without a rewrite. Node SEA keeps the
  kernel in the toolchain we already run.

## Consequences

- **Positive:** polyglot validation actually runs; the Station becomes any image;
  the three informal execution paths unify behind one tested port; the security
  posture is unchanged (Lore-hosted, image change is two-key gated). The default
  is preserved, so existing repos are unaffected.
- **Phased delivery:** (1) **Foundation** — `execution.image` settings (two-key
  gated) + `resolveExecutionImage` + threading the image through the existing
  `agents` port onto `CR.spec.image`, with **no behavior change** (the default
  image equals the controller's default). (2) **Portable kernel** — embed
  workflows, lazy SDK, Node SEA build, the `lore-kernel` init image. (3)
  **Two-stage pod + API agent node** — the controller templates
  initContainer→`emptyDir`→BYO main and selects the API handler for custom
  images (live execution-path change, staged). (4) **Proof** — a Go repo runs
  `go vet` end-to-end. A custom non-Node image is non-functional until phase 3, so
  until then a repo should leave `execution.image` at the default
  (`lore-claude-runner`-compatible).
- **Negative / risk:** phase 3 touches the live execution path and needs a staged
  cutover + rollback runbook (cf. the lore-floor namespace cutover). The SEA
  binary is Node-version-locked and must be rebuilt with the kernel.
