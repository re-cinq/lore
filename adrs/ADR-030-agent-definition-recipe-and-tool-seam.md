---
adr_number: 30
title: "AgentDefinition as a declarative recipe; the AgentTool seam; image/compute belong to the Station"
status: draft
date: 2026-06-18
domains: [agent, pipeline, security, web-ui, governance]
---

# ADR-030: AgentDefinition as a recipe, the AgentTool seam, and the Station boundary

This ADR redefines the AgentDefinition as a self-describing declarative recipe behind a tool-agnostic AgentTool seam with runner-owned output fan-out and gated privileged fields, and settles execution image and compute onto the Station rather than the definition.

> **Storage decision superseded by [ADR-031](./ADR-031-agent-station-crds.md).** The recipe is now a
> Kubernetes Custom Resource — the **source of truth**, edited via the web UI which applies the YAML
> to the cluster — **not** a `lore.agent_definitions` JSONB row. ADR-030's recipe *schema*, the
> **AgentTool seam**, the output fan-out, and the security gating are **retained**: they become the
> CRD `openAPIV3Schema` and runtime contract, generated from the D structs into the
> `@re-cinq/agent-contracts` code-API package. Image + compute live on the Station's embedded
> `PodTemplateSpec` (ADR-031), realizing §5 below. (Partially superseded — storage only.)

## Context

ADR-024 fixed the execution vocabulary (Factory ⊃ Floor ⊃ AssemblyLine ⊃ Station ⊃
Agent) and ADR-024's "Agent definitions as data" promoted per-task-type config to
`lore.agent_definitions`. Three problems remained under-specified:

1. **The execution image is schizophrenic.** It lives on `lore.agent_definitions.image`
   (merged by `resolveAgentConfig`, two-key gated in the agents route) *and* on
   `settings.dark_factory.execution.image` (resolved by `resolveExecutionImage`, the only
   one that actually reaches the pod). ADR-024 itself says both "execution image is part of
   the Agent definition" (line 40) and "`settings.execution.image` is **the Station's image**"
   (line 82). The column is effectively vestigial.

2. **The AgentDefinition is a thin recipe.** It carries only `model/timeout/prompt`. It
   cannot declare the *resources* a run needs (env, secrets, MCP servers, extra repos), the
   headless tool-access surface (`--allowedTools`, `--permission-mode`, `--append-system-prompt`),
   or how structured results leave the run. The settings UI exposed only model/timeout/a
   prompt-suffix.

3. **The Agent is hardcoded to Claude.** The runner always spawns `claude --print`. ADR-024
   reserves "Agent" for "the tool + a prompt" — *a* tool, not Claude specifically — but there
   is no seam for codex/cursor.

The guiding analogy (from the platform's manufacturing metaphor): an **AgentDefinition is a
Dockerfile/recipe**, an **Agent is the running container**, and a **Station is the running
context that pairs an execution image (and compute) with an Agent**.

## Decision

### 1. The AgentDefinition is a self-describing, declarative recipe
Every Lore declarative resource adopts the Kubernetes envelope — `apiVersion` + `kind` +
`metadata` + `spec` — so a file/stream announces what it is and a loader dispatches on `kind`
(`kubectl apply` style). `apiVersion` (e.g. `lore.re-cinq.com/v1`) carries the schema version;
there is no separate `schema_version` field. `kind: AgentDefinition` now; `kind: StationDefinition`
and `kind: Workflow` reuse the same envelope.

The recipe `spec` is **headless** config (`claude --print` is non-interactive) and **tool-agnostic
where possible**. Beyond today's `model/timeout/prompt`, the `spec` adds: `description`,
`append_system_prompt`, `allowed_tools[]`, `disallowed_tools[]`, `permission_mode`, `max_turns`,
`resources` (env / secrets / mcp_servers / repos), `output` (format / schema / select / sinks),
and a `tool_config` raw passthrough for the rarely-tuned long tail. The recipe carries **no
`image` and no compute** — those are the Station's. The full field set + per-property examples
live in `specs/agent-station-model/`.

Two decisions inside the recipe deserve calling out:
- **The model selects the tool.** A `claude-*` model can only run on the Claude adapter; pairing
  a `tool:` field with `model:` only invites contradiction. So there is **no `tool` field** — a
  model→adapter registry derives the `AgentTool` from `model` (unknown → default Claude + warn).
- **`permission_mode` is headless-only: `auto | bypass`.** The interactive modes
  (`default`/`acceptEdits`/`plan`) assume a human at a prompt, which does not exist in `--print`.
  `bypass` = today's `--dangerously-skip-permissions` (default, backward-compatible); `auto`
  enforces `allowed_tools`/`disallowed_tools` via the built-in classifier.

### 2. The Agent is a tool wrapper behind an `AgentTool` port
A new `AgentTool` port abstracts "run this prompt in this workdir with these resources, stream
events, return an exit code". The Claude adapter is the only one shipped now; codex/cursor are
future adapters behind the same interface. Adapters parse their native stream into a **normalized
`AgentEvent`** model so downstream selection/fan-out is tool-agnostic. Headless invariants
(`--print --verbose --output-format stream-json`) are fixed by the runner, never by config. The
Agent is a standalone app: it reads its resolved recipe from `--config <path>` or stdin (the Floor
hands it over — no self-fetch), and exits on the documented 0/2–9 matrix; SIGTERM → graceful stop.

### 3. Output is a configurable, runner-owned fan-out
There are two kinds of output. *Work product* (code edits) stays branch-as-state (commits with
`Lore-*` trailers, ADR-016) — unchanged. *Structured answers* return through the recipe's `output`
block: `format`, an optional `schema` (validated), `select[]` filters over the `AgentEvent` stream
(tool_call / message+contains / tool_result / result / usage), and `sinks[]` (`stdout` / `http` /
`file`). The **runner** owns the fan-out so it works for any wrapped tool (not Claude's native
hooks). This replaces the bespoke feature-planning `result.json` POST-back.

### 4. Privileged recipe fields are gated (security)
The pod holds `GITHUB_TOKEN` + `ANTHROPIC_API_KEY`, so recipe fields that execute commands or
reach arbitrary hosts are privileged:
- **Command execution** — stdio `mcp_servers[].command` and `tool_config` hooks: **two-key gated**
  (admin scope + a CODEOWNERS `dark-factory-approval` PR, reusing `verifyApproval`), the same
  ceremony `image` uses today.
- **Secret refs** — `secrets[].ref` / `headers_secret` / `token_secret` must be a subset of a
  per-repo allowlist (`settings.agent_secrets[]`), enforced at write *and* resolve.
- **Egress hosts** — http sink / http MCP / extra-repo URLs are checked against a per-repo
  allowlist; the NetworkPolicy stays default-deny, so opening a new host needs an ops-gated policy
  change, not just a recipe edit.
- **Literal-secret guard** — API-key/JWT/PEM-shaped strings in `env[].value` are rejected; secrets
  must be references.

### 5. Image + compute belong to the Station (defined; implementation deferred)
A Station is `(execution image + compute + an Agent)`. Its config will become a first-class record
(`StationDefinition` = `{ name, image, cpu, memory, disk, deadline, agent_def }`) so it is the full
running context, not just an image string. The tool binary (claude/codex/cursor) is baked into the
Station's image; the Agent never downloads it (egress lock-down). **This ADR resolves ADR-024's
line-40/line-82 inconsistency in favour of the Station**, but the Station record is **not built in
the first pass** — until then image resolution stays `resolveExecutionImage` /
`settings.execution.image` and compute stays the `job-builder` defaults. The glossary's "Agent
definition" row drops "execution image".

## Alternatives rejected

- **A separate `tool` field** — redundant with (and contradictable by) `model`; the model already
  determines the only adapter that can run it.
- **A `schema_version` integer** — `apiVersion` (the k8s envelope) already versions the document.
- **Modeling all ~40 Claude Code headless settings as columns** — most are rarely tuned; curate the
  load-bearing ones and keep a `tool_config` passthrough for the rest.
- **A new `ExecutionBackend` port for tool/image selection** — ADR-025 already rejected this as
  YAGNI; image flows as a field through the existing `AgentRunner`, and tool selection rides on
  `model`.
- **Building the `StationDefinition` record now** — deferred by decision to keep the first pass to
  the recipe + Agent + security; image/compute plumbing is untouched meanwhile.
- **Relying on Claude's native `SessionEnd type:http` hook for output** — not portable to
  codex/cursor; the runner owns fan-out instead (the hook remains available via `tool_config`).

## Consequences

- **Positive.** "AgentDefinition" stops being a stub: operators edit every recipe field (the
  Agents UI no longer exposes only a prompt-suffix). Tool choice is a model detail, so codex/cursor
  drop in behind `AgentTool` without schema churn. Output is declarative and tool-agnostic. The
  command/host-reaching fields that this expressiveness introduces are gated, closing an RCE/exfil
  surface. The k8s envelope makes recipes self-describing and `--config`/stdin-loadable on any
  machine.
- **Cost / migration.** New JSONB columns on `lore.agent_definitions` (a new append-only migration);
  existing `settings.task_overrides[type].system_prompt_suffix` migrates to `append_system_prompt`.
  `runClaudeCode` is refactored to sit behind `AgentTool` while preserving its signature and
  `pipeline.llm_calls` usage accounting. The local runner gains recipe parity with the cluster path.
- **Follow-up (separate effort).** The `StationDefinition` record (table + port + UI + Station-first
  resolution + compute sizing), after which `agent_definitions.image` is dropped and
  `resolveExecutionImage`/`settings.execution.image` retired.
- The canonical glossary stays [`specs/glossary.md`](../specs/glossary.md); this ADR enriches the
  "Agent definition" and "Station" rows there.
