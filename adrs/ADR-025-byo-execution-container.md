---
adr_number: 25
title: "BYO execution container: per-repo/per-task image, Lore-hosted, kernel sidecar"
status: shipped
date: 2026-06-15
domains: [agent, pipeline, infra, security]
---

# ADR-025: Bring-Your-Own execution container

This ADR adopts Lore-hosted Bring-Your-Own execution images so each repo runs its tasks in its own toolchain container beside a kernel sidecar, letting polyglot lint/typecheck validation actually run while keeping Lore's in-cluster, NetworkPolicy-restricted security perimeter.

> **Mechanism update ([ADR-031](./ADR-031-agent-station-crds.md)).** The BYO-image knob
> survives, but it no longer rides on the `LoreTask` CR's `image` field: a per-repo recipe
> sets it on the catalog `Station`'s pod template (the `image` two-key gate is preserved on
> the `/agent-definitions` endpoint). The substrate is the ai-agent-subsystem. And for
> Floor-driven assembly lines, `validate` nodes now run as their own **station pods** (the
> `lore-station` image runs `createValidateHandler` against the pod's clone at
> `$WORKSPACE_DIR/target`), so the station image *is* the toolchain container — superseding
> the sidecar relay below for that path. The relay remains for the in-pod agent runs it was
> built for.

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
GKE cluster; the repo supplies the toolchain container image; Lore runs its
execution kernel in a **sidecar** container next to it (not inside it).

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
- **Sidecar, not injection.** The kernel runs in **its own container on our
  image** (`lore-claude-runner` already carries node + claude + the supervisor),
  and the BYO image runs **alongside** it as a **native sidecar** (an
  initContainer with `restartPolicy: Always`, k8s ≥ 1.28). Both mount a shared
  `workspace` emptyDir. So the kernel is never hostage to the BYO image's runtime
  — no static binary, no SEA, no Go rewrite. `execution.image` names the
  **toolchain** container; default/unset ⇒ a single kernel container (today's
  pod, byte-for-byte). The pure `buildLoreTaskJob` templates both shapes.
- **The kernel drives toolchain commands over a POSIX-sh relay.** The BYO
  sidecar runs `RELAY_SCRIPT` — a small `sh` loop that watches the shared volume,
  runs each requested command in the repo's toolchain, and writes the result
  back; the kernel sends commands via `RelayExecutor`. The BYO image needs only
  `sh` + its toolchain — **nothing Lore-specific is injected into it**.
- **Polyglot validation** runs by having `detectTooling`'s commands execute in
  the BYO container through the relay, so `go vet` / `mypy` / `cargo check` run in
  the native toolchain. (Same relay later carries a full agentic tool-use loop:
  kernel = brain, BYO sidecar = hands.) For assembly-line `validate` nodes this is
  superseded by the station-pod path (top note, ADR-031); the relay serves the
  in-pod agent toolchain use it was built for.

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
- **Inject the kernel INTO the BYO container** (Node SEA single binary, or
  node+bundle) — **rejected after trying it**: node always links a libc, so a
  glibc binary won't run in musl (alpine) or `scratch` images — no node packaging
  can mean "runs in any container." And `postject` couldn't even inject the SEA
  blob into the *stripped* official node binary (it can't find the `NODE_SEA_FUSE`
  sentinel; it fails silently, producing a plain node). The sidecar sidesteps the
  whole libc/injection problem — the kernel runs in our own image.
- **Rewrite the kernel in Go (a truly static binary)** — genuinely portable, but
  a full rewrite plus cross-language duplication of the workflow engine, leases,
  trailers, and LLM client that the TS kernel shares with the in-agent and local
  runner paths. The sidecar reaches the same outcome reusing the proven TS kernel.
  (Kept open as the future shape for a *remote/customer-hosted* static agent that
  connects back to Lore's API — the GitLab-runner model.)

## Consequences

- **Positive:** polyglot validation actually runs; the Station becomes any image;
  the three informal execution paths unify behind one tested port; the security
  posture is unchanged (Lore-hosted, image change is two-key gated). The default
  is preserved, so existing repos are unaffected.
- **Phased delivery:** (1) **Foundation** (done, #601) — `execution.image`
  settings (two-key gated) + `resolveExecutionImage` + threading the image onto
  `CR.spec.image`, no behavior change. (2) **Sidecar mechanism** (this) — the
  relay (`RELAY_SCRIPT` + `RelayExecutor`, proven by a real round-trip test) and
  the pure `buildLoreTaskJob` (single-container default / kernel + BYO native
  sidecar + shared volume), wired into the controller; still no behavior change
  (the default image ⇒ single container). (3) **Validation-via-relay + live
  cutover** — the kernel runs `detectTooling`'s commands in the BYO sidecar over
  the relay when `LORE_TOOLCHAIN_RELAY` is set; staged live rollout. (4) **Proof**
  — a Go repo runs `go vet` end-to-end. BYO isn't end-to-end until phase 3, so a
  repo should leave `execution.image` at the default until then.
- **Negative / risk:** phase 3 touches the live execution path and needs a staged
  cutover + rollback runbook (cf. the lore-floor namespace cutover). The relay
  adds a small command/result protocol over the shared volume; the BYO image must
  carry `sh` + its toolchain (true for real coding images; `scratch`/distroless-
  static can't host a task anyway). Native sidecars require k8s ≥ 1.28.
