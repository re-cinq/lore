---
name: prototype-flows
description: Draw one flow a plan describes as a mermaid sequence diagram or flowchart for the plan's Prototype section. Use when a plan describes a request, a run, a hand-off or an assembly line, who starts it, each step in order, and where it fails. Renders under mermaid's strict security level.
---

# Prototype: flows

One diagram per flow. A flow has a starter, steps in order and an
end, and at least one way it fails. Draw what the plan decides, in
the plan's words, with the names the code uses.

## Pick the diagram

- **`sequenceDiagram`** when several parties pass messages: a person,
  the web page, an API, a worker, GitHub. Time runs down the page.
- **`flowchart`** when one thing moves through steps and branches: an
  assembly line, a job, a decision. Draw an assembly line station by
  station, with each outcome (`success`, `failure`, `due`, `not due`)
  on the edge it leaves by.

## Method

1. Find who starts the flow: a person's click, a webhook, a cron
   tick. That is the first participant or the first node.
2. Write each step in order, one message or one node each. Name a
   station, route or event by its name in the code at
   /workspace/target (a pipeline file under the repository's assembly
   lines, a route folder) or by the name the plan gives a new one.
3. Draw the failure branch the plan cares about: a refusal, a timeout,
   a red check. In a sequence use `alt` / `else` / `end`; in a
   flowchart a labelled edge.
4. Stop where the plan stops. A flow that continues elsewhere ends in
   a node or note naming where it goes.
5. Two flows are two sketches: `m-flow-1`, `m-flow-2`.

## Format

- `format: "mermaid"`, `kind: "flow"`, id `m-flow-<n>`.
- `height`: about 45 px per message in a sequence, 60 px per rank in
  a flowchart; 280 to 640 for most.

## Rules that keep it rendering

The page renders with `securityLevel: "strict"` and
`flowchart.htmlLabels: false`.

Sequence diagrams:

- Declare every participant first: `participant api as lore-api`.
  The alias text is not quoted; quotes would print.
- Keep `;` and `#` out of message text: `;` ends the statement and
  `#` starts an entity code.
- Every `alt`, `opt`, `loop` and `par` closes with its own `end` line.
- No HTML in messages or notes, one line each.

Flowcharts:

- Quote every label holding punctuation, parentheses, slashes or
  colons: `pass["plan-pass-end (settles)"]`.
- No HTML in labels; one short line each.
- Ids are plain letters and digits; never `end` as an id.
- Spaces around arrows, one statement per line, no trailing `;`.
- Quote edge labels: `due -->|"not due"| author`.

## Worked example

Caption: `Generate prototype, from the button to the plan`

```
sequenceDiagram
  actor person as Person
  participant page as Plan page
  participant api as lore-api
  participant floor as Floor
  participant agent as plan-sketch
  person->>page: Generate prototype
  page->>api: POST /plans/p1/prototype
  alt plan approved or agent busy
    api-->>page: 409 with the reason
    page-->>person: reason under the button
  else
    api->>floor: start node sketch
    api-->>page: run id
    floor->>agent: plan id and the code
    agent->>api: lore_plan_edit add-mockup m-flow-1
    api-->>page: sketch appears in Prototype
  end
```

Height 420.

## Help

<!-- lore-help:begin -->
**Summary.** Draw one flow from a plan as a mermaid sequence diagram or flowchart: the starter, each step in order, the failure branch.
**Usage:** `/prototype-flows`
**Use when.** A plan describes a request, a run, a hand-off or an assembly line and its Prototype section needs a flow sketch.
**Related:** `/prototype-architecture`, `/prototype-states`
<!-- lore-help:end -->
