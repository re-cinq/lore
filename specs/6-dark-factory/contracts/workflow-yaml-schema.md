# Contract: Assembly line YAML schema

The on-disk format for assembly line graphs. Loaded by the Floor (`libs/assembly-lines/src/loader.ts`); the local runner does not load it yet — spec FR2.3's shared-interpretation goal is aspirational until it adopts the library. Per FR2.1, this is the only graph format.

## File location

- Built-in: `libs/assembly-lines/src/assembly-lines/<definition>.yaml`
- A per-repo override (`lore.repos.settings.workflows[].definition`, inline YAML) was designed but is not implemented — today only the builtin directory is loaded.

## Schema (Zod)

```ts
const NodeType = z.enum([
  "agent", "validate", "gate", "retrospective", "github_action", "detect",
  "comment-triage", "ingest",
]);
const EdgeCondition = z.enum(["success", "changes_requested", "failed", "always"]);

const NodeSchema = z.object({
  // Node ids are embedded in the Agent CR NAME (`<assemblyLineId:12>-<nodeId>`,
  // DNS-1123) and in a CR label value, so they must be DNS-label-safe:
  // lowercase alnum + hyphen, no leading/trailing hyphen, no underscore.
  id: z.string().regex(/^[a-z]([a-z0-9-]*[a-z0-9])?$/).max(50),
  type: NodeType,
  // type-specific fields:
  prompt_ref: z.string().optional(),       // for agent nodes — references a prompt template
  model: z.string().optional(),            // for agent nodes — overrides default
  validator: z.string().optional(),        // for validate nodes — "lint" | "typecheck" | "all"
  condition_ref: z.string().optional(),    // for gate nodes — "auto_merge_eligible" | "review_passed" | ...
  job_ref: z.string().optional(),          // for detect nodes — REQUIRED; keys the detector registry
  station_ref: z.string().optional(),      // custom station (agent-definitions name) overriding def-<type>
  timeout_minutes: z.number().int().positive().optional(),  // per-node run timeout (station-contract.md)
  description: z.string().optional()
});

const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  on: EdgeCondition,
  iteration_max: z.number().int().positive().optional()  // required if `from` and `to` form a loop
});

const AssemblyLineSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.literal(1),
  entry: z.string(),                                          // node id
  exit: z.string(),                                           // node id
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema)
});
```

## Validation rules

- `entry` and `exit` MUST refer to existing node ids; edges MUST reference existing nodes.
- Every node except `exit` MUST have at least one outgoing edge.
- Every node except `entry` MUST be reachable from `entry`.
- Cycles MUST have `iteration_max` set on the back-edge; otherwise loader rejects the graph.
- A `detect` node without `job_ref` MUST be rejected at load time.
- Outcome coverage (spec FR2.7, #946): every producible outcome of a non-exit node MUST have a matching edge (exact or `always`) — every type produces `success` and `failed`; agent nodes additionally `changes_requested`. Rejected at load time so `nextTransition` never hits a no-edge walk crash at runtime.
- `prompt_ref` / `condition_ref` / `validator` values are NOT registry-checked at load time — they resolve at dispatch (agent-definitions lookup / station params).
- Loader is fail-fast: malformed YAML, a schema violation, or a duplicate definition name aborts Floor startup.

## Builtin definitions

`libs/assembly-lines/src/assembly-lines/` currently holds: `implementation`, `general`, `gap-fill`,
the PR-review choreography lines (`code-review`, `code-review-reply`, `comment-triage`), the
feature-planning pair (`feature-planning`, `feature-finalize`), the detection family (`spec-drift`,
`gap-detect`, `spec-coverage-validate`, `spec-coverage-backfill`), and `ingest`. The examples below
are excerpts of the real files — when they drift, the YAML wins.

## Example: implementation flow

```yaml
name: implementation
description: Implement a spec, validate, push, review. On changes_requested, address feedback up to 2 iterations.
version: 1
entry: implement
exit: done

nodes:
  - id: implement
    type: agent
    prompt_ref: implementation
    model: claude-sonnet-4-6
  - id: validate
    type: validate
    validator: all
  - id: push
    type: agent
    prompt_ref: push-only
    description: Open or update the PR
  - id: review
    type: agent
    prompt_ref: review
    model: claude-haiku-4-5-20251001
  - id: address
    type: agent
    prompt_ref: address-feedback
    model: claude-sonnet-4-6
  - id: retrospective
    type: retrospective
  - id: done
    type: retrospective
    description: terminal marker

edges:
  - from: implement
    to: validate
    on: success
  - from: implement
    to: implement
    on: failed
    iteration_max: 1
  - from: implement
    to: retrospective
    on: changes_requested
  - from: validate
    to: push
    on: success
  - from: validate
    to: implement
    on: failed
    iteration_max: 1
  - from: push
    to: review
    on: always
  - from: review
    to: retrospective
    on: success
  - from: review
    to: address
    on: changes_requested
    iteration_max: 2
  - from: address
    to: validate
    on: always
    iteration_max: 2
  - from: review
    to: retrospective
    on: failed
  - from: retrospective
    to: done
    on: always
```

## Example: gap-fill flow (linear, no review)

```yaml
name: gap-fill
description: Draft missing context as docs, validate, push. No human review on the auto-merge path.
version: 1
entry: draft
exit: done

nodes:
  - id: draft
    type: agent
    prompt_ref: gap-fill
    model: claude-haiku-4-5-20251001
  - id: validate
    type: validate
    validator: all
  - id: push
    type: agent
    prompt_ref: push-only
  - id: retrospective
    type: retrospective
  - id: done
    type: retrospective

edges:
  - from: draft
    to: validate
    on: success
  - from: draft
    to: retrospective
    on: changes_requested
  - from: draft
    to: draft
    on: failed
    iteration_max: 1
  - from: validate
    to: push
    on: success
  - from: validate
    to: draft
    on: failed
    iteration_max: 1
  - from: push
    to: retrospective
    on: always
  - from: retrospective
    to: done
    on: always
```

## Example: detection flow (repo-less, deterministic)

A `detect` node runs a deterministic, repo-scoped detection job (DB + graph
reads) inside the walk — no clone, no PR, no LLM prompting of its own. `job_ref`
keys the Floor's injected detector registry
(`apps/floor/src/jobs/detect/detectors.ts`); the run is started per repo by the
`cron.<job>.tick` fan-out (ADR-019 amendment).

```yaml
name: spec-drift
description: Per-repo spec drift detection; files gap-fill tasks for drifted specs.
version: 1
entry: detect
exit: done

nodes:
  - id: detect
    type: detect
    job_ref: spec_drift
  - id: done
    type: retrospective
    description: Terminal marker (the executor halts on exit).

edges:
  - from: detect
    to: done
    on: success
  - from: detect
    to: done
    on: failed
```

## Versioning

- `version: 1` is the only currently valid value.
- Schema-incompatible changes bump to `version: 2` and run side-by-side with v1 for one release cycle.
- Adding a new optional field is NOT a version bump.
- Adding a new node type is NOT a version bump (existing graphs unaffected).
- Adding a new edge condition is NOT a version bump.

## Out-of-scope (today)

- Parallel branches (a node firing two outgoing edges concurrently). Today: every node has exactly one active outgoing edge per execution.
- Sub-assembly-lines (calling another assembly line as a node). Today: each task runs exactly one assembly line.
- Inline expressions (CEL/expr) on edges. Today: only the four enum conditions.
