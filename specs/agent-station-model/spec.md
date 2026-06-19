# Feature Specification: AgentDefinition recipe + AgentTool seam

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | AgentDefinition recipe + AgentTool seam       |
| Branch   | feat/agent-definition-recipe-standard         |
| Status   | In review                                     |
| Created  | 2026-06-18                                    |
| Owner    | Platform Engineering                          |
| ADR      | ADR-030 (builds on ADR-024 / ADR-025)         |

## Why

The `AgentDefinition` ([glossary](../glossary.md)) was a thin stub — `model/timeout/prompt`
only — so it could not declare the resources a run needs, the headless tool-access surface, or
how structured results leave the run; the UI exposed only a prompt-suffix. The execution `image`
was duplicated across the definition and `settings.execution.image`. And the Agent was hardcoded
to Claude. This promotes the definition to a **declarative recipe** (the Dockerfile to the Agent's
container), introduces the **`AgentTool`** seam (claude now; codex/cursor later), a configurable
**output** contract, and a **security model** for the command/host-reaching fields the recipe now
allows. Image + compute move to the **Station** conceptually (built later). See
[ADR-030](../../adrs/ADR-030-agent-definition-recipe-and-tool-seam.md).

## Scope

In (this round): the recipe `spec` fields + `resources` + `output` on `lore.agent_definitions`;
the `apiVersion`/`kind`/`metadata`/`spec` envelope + `loadResourceDoc`; the `AgentTool` port +
Claude adapter + model→tool selection; `resource-plan` / `output-select` / `output-sink`; the
two-key gate on privileged fields + per-repo secret allowlist; runner + local-runner wiring;
`--config`/stdin invocation; the Agents UI exposing every field.

Out (deferred — separate effort): the `StationDefinition` first-class record (table/port/UI),
Station-first image resolution, compute sizing off `job-builder`, and the eventual drop of
`agent_definitions.image` / retirement of `resolveExecutionImage`.

## The resource envelope (Kubernetes-style)

Every Lore declarative resource is self-describing — `apiVersion` + `kind` + `metadata` + `spec`
— and `loadResourceDoc` dispatches on `kind` like `kubectl apply`. `apiVersion` carries the schema
version (no separate `schema_version`).

```yaml
apiVersion: lore.re-cinq.com/v1
kind: AgentDefinition
metadata:
  name: implementation        # = task-type key; org-default vs repo-override by project_id
spec: { ... }                 # the recipe (below)
```

## Recipe `spec` — per-property reference (each: example + effect)

- **`description`** — `description: "Implements a merged spec into source edits"` — human summary
  shown in the Agents UI; no runtime effect.
- **`model`** — `model: claude-sonnet-4-6` — the model id; **also selects the `AgentTool`** via the
  model→adapter registry (`claude-*` → Claude). `null` inherits the next layer.
- **`timeout_minutes`** — `timeout_minutes: 90` — wall-clock budget; maps to the run timeout
  (and, in cluster mode, the Job `activeDeadlineSeconds`). `null` inherits.
- **`execution_mode`** — `execution_mode: claude-code` — `claude-code` (LLM run) or `graph-ingest`
  (deterministic, zero-LLM; recipe tool/resources/output are N/A).
- **`review_required`** — `review_required: true` — whether the resulting PR needs human review.
- **`prompt`** — `prompt: "Implement the task below.\n{description}"` — the task/user-message
  template; `{description}` is substituted. `null` inherits.
- **`append_system_prompt`** — `append_system_prompt: "Always add ([validated by]) links."` —
  appended to the tool's default system prompt (append, not replace, so safety/tool guidance is
  preserved). Maps to `--append-system-prompt`.
- **`allowed_tools`** — `allowed_tools: ["Bash(npm run test:*)", "Read(/src/**)", "Edit(/src/**)"]`
  — permission rules the tool may use without prompting; maps to `--allowedTools`. Claude-shaped
  syntax (per-adapter).
- **`disallowed_tools`** — `disallowed_tools: ["Bash(rm *)", "WebSearch"]` — scoped denials; maps
  to `--disallowedTools`.
- **`permission_mode`** — `permission_mode: auto` — headless-only. `bypass` (default) grants all
  (today's `--dangerously-skip-permissions`); `auto` enforces the allow/deny lists via the
  built-in classifier. `default`/`acceptEdits`/`plan` are excluded (no headless approver).
- **`max_turns`** — `max_turns: 40` — caps agentic turns; maps to `--max-turns`. `null` = uncapped.
- **`resources`** — `resources: { env: [...], secrets: [...], mcp_servers: [...], repos: [...] }`
  — see below.
- **`output`** — `output: { format, schema?, select[], sinks[] }` — see below.
- **`tool_config`** — `tool_config: { fallbackModel: ["claude-haiku-4-5-20251001"], effort: high }`
  — raw passthrough for tool-specific knobs not modeled; merged by the adapter; not portable.
- **`project_id`** — server-set; `null` = org default, a value = that repo's override.

### `resources` — per-property reference

- **`env`** — `env: [{ name: NODE_ENV, value: production }]` — plain (non-secret) env the tool
  process sees. Literal credentials are rejected (use `secrets`).
- **`secrets`** — `secrets: [{ name: GITHUB_TOKEN, ref: github-token }]` — `name` is the env var
  the tool sees; `ref` is a **key in the per-repo allowlist** (`settings.agent_secrets[]`),
  resolved at run time. Never a literal.
- **`mcp_servers`** — http: `{ name: lore, transport: http, url: https://…/mcp, headers_secret: lore-mcp-token }`;
  stdio: `{ name: fs, transport: stdio, command: npx, args: ["-y","@mcp/server-fs","/workspace/repo"] }`
  — written to an MCP config file and passed via `--mcp-config` (merged with, not replacing, the
  built-in Lore server). A stdio `command` is **privileged** (two-key gated).
- **`repos`** — `repos: [{ name: ds, url: github.com/acme/ds, ref: main, path: vendor/ds, token_secret: github-token }]`
  — extra repos cloned beside the target at `path`; `url` host is allowlist-checked.

### `output` — per-property reference

- **`format`** — `format: stream-json` — the tool's output format the runner captures
  (`text`|`json`|`stream-json`).
- **`schema`** — `schema: { type: object, required: [verdict] }` — optional JSON Schema; the
  collected result is validated against it.
- **`select`** — `select: [{ event: tool_call, tool: Bash }, { event: message, role: assistant, contains: "DECISION:" }, { event: result }]`
  — filters the normalized `AgentEvent` stream; omit = final `result` only.
- **`sinks`** — `sinks: [{ type: stdout }, { type: http, url: https://…/result, headers_secret: result-token }, { type: file, path: $LORE_RESULT_PATH }]`
  — where the selected events go; the runner owns the fan-out. `http` `url` is allowlist-checked.

## Security model

The pod holds `GITHUB_TOKEN` + `ANTHROPIC_API_KEY`; recipe fields that run commands or reach hosts
are privileged. Command-execution fields (stdio `mcp_servers[].command`, `tool_config` hooks) are
**two-key gated** (admin scope + a CODEOWNERS `dark-factory-approval` PR, reusing `verifyApproval`).
Secret refs must subset the per-repo allowlist (enforced at write and resolve). Egress hosts (http
sink / http MCP / extra-repo) are allowlist-checked and bounded by the default-deny NetworkPolicy.
Literal API-key/JWT/PEM strings in `env[].value` are rejected.

## Requirements

> `([validated by])` links are added as each test goes green (TDD).

- **FR1 — Envelope + kind dispatch.** `loadResourceDoc(text)` parses `apiVersion`/`kind`/`metadata`/`spec`
  from YAML or JSON and dispatches on `kind`, validating `spec` against that kind's schema; an
  unknown `kind` or missing envelope is a typed error.
- **FR2 — Recipe resolution.** `resolveAgentConfig` field-merges the new spec fields project → org →
  yaml; `resources`/`output`/`tool_config` merge by whole-object replace per layer.
- **FR3 — Model selects tool.** `selectAgentTool(model)` returns the Claude adapter for `claude-*`
  models and the registry default (Claude) + a warning for unknown models; there is no `tool` field.
- **FR4 — Claude flag mapping.** The Claude adapter maps the recipe to
  `--allowedTools/--disallowedTools/--permission-mode/--append-system-prompt/--mcp-config/--max-turns`
  and preserves the headless invariants.
- **FR5 — Resource planning.** `planResources(resources, resolveSecret, workDir)` materializes
  `env` (literals + resolved secret refs), builds the MCP config object, and lists extra-repo clone
  steps; a secret `ref` outside the allowlist (or missing) is a typed error.
- **FR6 — MCP merge.** Per-run MCP servers are passed without `--strict-mcp-config`, so the built-in
  Lore MCP server still resolves.
- **FR7 — Output selection.** `selectEvents(events, select)` returns only the matching normalized
  `AgentEvent`s (by `event` kind, `tool`, `role`, `contains`); omitting `select` yields the `result`.
- **FR8 — Output fan-out.** `dispatchOutput(selected, sinks, resolveSecret)` validates against
  `schema` (when set) and writes to `stdout`, POSTs to `http`, and writes the `file` sink.
- **FR9 — Literal-secret guard.** Submitting a recipe with an API-key/JWT/PEM-shaped `env[].value`
  is rejected at the API.
- **FR10 — Privileged-field gate.** A write that sets a stdio MCP `command` or a `tool_config` hook
  requires the two-key approval ceremony; absent it, the write is refused.
- **FR11 — Secret allowlist.** A write referencing a secret `ref` outside `settings.agent_secrets[]`
  is refused; resolution of such a ref at run time also fails.
- **FR12 — `--config`/stdin invocation.** The runner accepts the resolved recipe via a `--config <file>`
  flag and via stdin, both parsed by `loadResourceDoc`.
- **FR13 — Backward compatibility.** A recipe with none of the new fields produces the same launch
  as today; usage still logs to `pipeline.llm_calls`.
- **FR14 — Local/cluster parity.** The local runner honors the same recipe (tool/resources/output/
  permissions) as the cluster path.
- **FR15 — Config migration.** Existing `settings.task_overrides[type].system_prompt_suffix` is
  migrated into the project row's `append_system_prompt`.

## Out of scope (restated)

The `StationDefinition` record, Station-first image resolution, compute sizing, and dropping
`agent_definitions.image` are a follow-up (ADR-030 §5). Until then image resolution is unchanged.
