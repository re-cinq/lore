---
name: prototype-states
description: Draw the lifecycle of something a plan gives a status as one mermaid stateDiagram-v2 for the plan's Prototype section. Use when a plan adds or changes statuses of a task, a run, a ticket, a plan or a request, every status, what moves it to the next, and where it ends. Renders under mermaid's strict security level.
---

# Prototype: states and lifecycle

One mermaid `stateDiagram-v2` per thing that has a status. A reader
sees every status it can be in, what moves it, and where it stops.

## When to use

- The plan adds a status, a pause, a retry, an approval or a cancel.
- The plan changes what moves something from one status to another.

Not for a sequence of calls between services: that is a flow sketch.

## Method

1. Find the statuses that exist today in /workspace/target: the enum,
   the status column's values, the union type. Use those words.
2. Add the statuses the plan adds, with the plan's words.
3. Draw every transition with its trigger on the arrow: the person's
   action, the event, the timeout. Leave none unlabelled.
4. Start at `[*]` and end each final status at `[*]`. Draw a status
   with no way out exactly as the plan leaves it: the people reading
   the sketch are the ones to notice the gap.
5. Group sub-statuses with a composite state only when the plan
   treats them as one from outside.

## Format

- `format: "mermaid"`, `kind: "states"`, id `m-states-<n>`.
- `height`: about 70 px per status down the longest path; 280 to 600.
- `direction LR` on the second line suits a long single path.

## Rules that keep it rendering

- State ids are plain letters and digits. A status with a space or a
  dash is declared with a label first:
  `state "awaiting CI" as awaitingCi`.
- Never `end` as a state id; use `done`.
- A transition label follows one colon and holds no further colon and
  no `;`: `pending --> running : claimed by a worker`.
- No HTML, one statement per line.
- `note right of running : text` holds plain text on one line.

## Worked example

Caption: `A sketch request from Generate to drawn`

```
stateDiagram-v2
  state "asked" as asked
  state "agent drawing" as drawing
  state "drawn" as drawn
  state "failed" as failed
  [*] --> asked : Generate prototype
  asked --> drawing : node sketch starts
  drawing --> drawn : one sketch or more written
  drawing --> failed : agent reports failure
  failed --> asked : Generate again
  drawn --> asked : Refine of the section
  drawn --> [*]
```

Height 420.

## Help

<!-- lore-help:begin -->
**Summary.** Draw every status of something a plan touches, what moves it and where it ends, as a mermaid stateDiagram-v2.
**Usage:** `/prototype-states`
**Use when.** A plan adds or changes statuses or a lifecycle and its Prototype section needs a states sketch.
**Related:** `/prototype-flows`, `/prototype-data-model`
<!-- lore-help:end -->
