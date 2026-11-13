---
name: prototype-api
description: Sketch each new API surface a plan adds as plain-text example exchanges for the plan's Prototype section. Use when a plan adds or changes an HTTP endpoint, an event, a queue message, a webhook or an MCP tool, one example request and response per surface, with real field names, realistic values and the errors a caller will meet.
---

# Prototype: API and messages

A plain-text sketch of what crosses the new surface, written as the
caller and the receiver would see it on the wire. A reader checks the
names, the shapes and the errors before anyone writes a handler.

## When to use

- The plan adds or changes an endpoint, a route's body or answer.
- The plan adds an event on a bus, a webhook, a queue message or an
  MCP tool and its arguments.

Not for the order of calls: that is a flow sketch.

## Method

1. Find a neighbour in /workspace/target: an existing endpoint, event
   or tool of the same family. Copy its conventions: path shape, case
   of field names (`snake_case` or `camelCase`), how errors look,
   which status codes it uses, how it names ids.
2. For each new surface write one success exchange, then each error
   the plan names or a caller will plainly meet (refused, not found,
   conflict, invalid input).
3. Use realistic values: ids in the format the repository uses, real
   repository names from the plan, timestamps in ISO 8601. Never
   `foo`, `bar`, `string` or `123`.
4. Show only the headers that matter to the change (auth scheme,
   content type, an idempotency key).
5. Several surfaces of one feature go in one sketch, each under a
   heading line; split only past about 120 lines.

## Format

- `format: "text"`, `kind: "api"`, id `m-api-<n>`.
- Plain text, no markdown fences inside. JSON pretty-printed with two
  spaces. A line `### <surface>` names each surface; a blank line
  separates the request from the response.
- `height`: 18 px per line plus 24; most sketches 300 to 900.
- No secrets, tokens or real personal data: write `Bearer <token>`.

## Shapes

HTTP:

```
POST /api/repos/re-cinq/lore/plans/143a6e64/prototype
Authorization: Bearer <token>
Content-Type: application/json

{ "actor": "ana-ops" }

200 OK
{ "run_id": "a1b2c3d4" }
```

Event or message: the event name on its own line, then the payload.
MCP tool: the tool name, then the arguments object, then the text the
tool answers.

## Worked example

Caption: `Ask for a prototype and the refusals`

```
### POST /api/repos/{owner}/{repo}/plans/{id}/prototype

POST /api/repos/re-cinq/lore/plans/143a6e64/prototype
{ "actor": "ana-ops" }

200 OK
{ "run_id": "a1b2c3d4" }

409 Conflict
{ "error": "This plan is approved; reopen it to change it." }

409 Conflict
{ "error": "The agent is working on this plan; wait for it to finish." }

404 Not Found
{ "error": "plan 143a6e64 not found" }
```

Height 360.

## Help

<!-- lore-help:begin -->
**Summary.** Sketch each new endpoint, event, message or tool a plan adds as example exchanges with real field names, realistic values and errors.
**Usage:** `/prototype-api`
**Use when.** A plan adds or changes an API surface and its Prototype section needs an API sketch.
**Related:** `/prototype-flows`, `/prototype-text-output`
<!-- lore-help:end -->
