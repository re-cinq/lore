# Contract: Station images

How a container becomes an assembly-line **station** — a pod that runs exactly one
non-agent node (validate, detect, gate, retrospective, github_action,
comment-triage, ingest, or a custom type) dispatched by the Floor as an Agent CR
on the ai-agent-subsystem (ADR-031 amendment). The builtin stations implement this contract in
`apps/lore-station/` (image `ghcr.io/re-cinq/lore-station`); any external image
honoring it plugs in the same way.

## Invocation

The subsystem's `exec` vendor spawns the recipe's `tool_config.command` argv with
the rendered prompt appended. Station recipes use the prompt template
`{station_input}`, so the process sees:

```
<your-command> [<your-args> ...] '<station_input JSON>'
```

### The `station_input` JSON (final argv element)

Produced by the Floor's `nodeStationSpec`
(`apps/floor/src/jobs/assembly-line/floor-assembly-line.ts`); parsed by
`apps/lore-station/src/input.ts` (the reference zod schema):

```json
{
  "assembly_line_id": "a1b2c3d4e5f6a7b8",
  "node_id": "validate",
  "node_type": "validate",
  "repo": "owner/name",
  "branch": "lore/impl-abcdef12",
  "task_id": "abcdef1234567890",
  "params": { "validator": "all" }
}
```

- `task_id` is **null** for task-less runs (detection assembly lines).
- `params` carries the node YAML's execution knobs (`validator`, `job_ref`,
  `condition_ref`, `prompt_ref`, `model`) — only the ones the node set.

### Environment

| Var | Source | Meaning |
|---|---|---|
| `AGENT_NAME` | subsystem | The CR name, `<assemblyLineId:12>-<nodeId>` (`-<iteration>` appended on revisits) |
| `TASK_ID`, `TARGET_REPO`, `BRANCH_NAME` | subsystem | Run identity |
| `WORKSPACE_DIR` | subsystem | Default `/workspace`; the target repo's branch is cloned at `$WORKSPACE_DIR/target` by the init container |
| `LORE_API_URL` | recipe env | The Lore API — ALL data access goes through it (pods have no Postgres, D7) |
| `LORE_STATION_TOKEN` | recipe secret (`agent-secrets`) | Scoped bearer (`read`, `task`) for the API |

## Output

Newline-delimited JSON on **stdout** (streamed to the run's sinks). The process
MUST end with one claude-style terminal line — the supervisor's existing
terminal detection keys on it, and its `result` text lands in
`Agent.status.output` where the Floor reads it back:

```json
{"type":"result","is_error":false,"result":"LORE_NODE_RESULT: {\"outcome\":\"success\",\"extras\":{\"Lore-Validation\":\"passed\"}}"}
```

- `outcome`: `success` | `changes_requested` | `failed`. **`failed` is a normal
  result** — it routes the assembly line's `failed` edge; exit 0 with
  `is_error:false`.
- `extras`: optional string→string map returned to the Floor alongside the
  outcome (stage commits were retired with the in-process walk — extras are NOT
  persisted as trailers). Specific keys drive routing: e.g. the comment-triage
  station's `action` selects the follow-up line. Keep it under ~1 KB total; long
  detail belongs in the log lines, not extras.
- LLM usage (stations that make their own model calls, e.g. comment-triage):
  report it on the `NodeResult.usage` field — `resultLine` lifts it onto the
  terminal line as the claude-style envelope fields the `/api/agent-events`
  cost sink reads (`model`, `usage.{input_tokens,output_tokens}`,
  `total_cost_usd`, `duration_ms`), yielding the run's `pipeline.llm_calls`
  row. Pods have no Postgres (D7); this is the only cost-reporting path. The
  usage never appears inside the `LORE_NODE_RESULT` payload, and omitting it
  leaves the terminal line byte-identical to the shape above.
- Infrastructure failures (can't parse input, dependency unreachable): emit
  `{"type":"result","is_error":true,"result":"<message>"}` and exit non-zero →
  the CR goes `Failed` → the Floor maps it to `failed` +
  `Lore-Validation-Status: station-failed`.
- Anything the pod prints before the terminal line is log stream
  (`{"type":"log","message":"..."}` recommended).

### Envelope ownership (one wrap, one unwrap)

`libs/assembly-lines/src/agent-output.ts` is the single source of truth for
this envelope: stations emit through its `resultLine`/`eventLine` (which
enforce-throw when asked to wrap a payload that is already a wrapped output
line — the envelope is applied exactly once), and every Floor reader unwraps
through its `resultTextFromOutput`.

The subsystem's `{"source": {...}, "event": <line>}` attribution wrapper
exists ONLY on the sink lanes (the `/api/agent-events` cost sink, file sinks),
where streams from many pods merge — never on stdout / `Agent.status.output`.
Pre-cutover CRs (written while the subsystem still stamped attribution onto
stdout) carry the wrapped shape in `status.output`; `resultTextFromOutput`
transitionally peels that one layer and the shim is deleted once no such CRs
remain.

## Timeouts

The referenced Station CR's `deadlineMinutes` is the hard stop (Kubernetes kills
the pod; default 15 for builtins). A node YAML `timeout_minutes` bounds the
Floor's await at `timeout + 2 min` so the deadline kill is observed rather than
raced; an expired await yields `failed` + `Lore-Validation-Status:
station-timeout`.

## Registering a custom station

1. Publish an image honoring this contract.
2. Register it as an agent-definitions row (org default or per-repo override)
   with `execution_mode: "station"`, the image, and a timeout — via the /agents
   UI or API. Image changes ride the existing two-key approval gate.
3. Reference it from node YAML:

```yaml
nodes:
  - id: scan
    type: detect
    job_ref: acme_scan
    station_ref: acme-scanner   # default would be def-detect
    timeout_minutes: 20
```

Builtins resolve to `def-<node type>` (seeded by gen-catalog from
`scripts/task-types.yaml` `stations:`).
