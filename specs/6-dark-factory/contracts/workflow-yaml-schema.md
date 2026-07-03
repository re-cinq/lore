# Contract: Assembly line YAML schema

The on-disk format for assembly line graphs. Loaded by both the GKE supervisor (`libs/assembly-lines/src/loader.ts`) and the local runner. Per FR2.1, this is the only graph format.

## File location

- Built-in: `libs/assembly-lines/src/assembly-lines/<task_type>.yaml`
- Per-repo override: `lore.repos.settings.workflows[].definition` (inline YAML string)

## Schema (Zod)

```ts
const NodeType = z.enum(["agent", "validate", "gate", "retrospective"]);
const EdgeCondition = z.enum(["success", "changes_requested", "failed", "always"]);

const NodeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  type: NodeType,
  // type-specific fields:
  prompt_ref: z.string().optional(),       // for agent nodes — references a prompt template
  model: z.string().optional(),            // for agent nodes — overrides default
  validator: z.string().optional(),        // for validate nodes — "lint" | "typecheck" | "all"
  condition_ref: z.string().optional(),    // for gate nodes — "auto_merge_eligible" | "review_passed" | ...
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

- `entry` and `exit` MUST refer to existing node ids.
- Every node except `exit` MUST have at least one outgoing edge.
- Every node except `entry` MUST be reachable from `entry`.
- Cycles MUST have `iteration_max` set on the back-edge; otherwise loader rejects the graph.
- Unknown `prompt_ref` / `condition_ref` / `validator` values MUST be rejected at load time, not at execution time.
- Loader is fail-fast: malformed YAML or schema violation prevents supervisor startup.

## Example: implementation flow

```yaml
name: implementation
description: Implement a spec, validate, push, review, address feedback up to 2 iterations
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
description: Draft missing context as docs, validate, push
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
  - from: validate
    to: push
    on: success
  - from: push
    to: retrospective
    on: always
  - from: retrospective
    to: done
    on: always
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
