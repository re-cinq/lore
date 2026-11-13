---
name: prototype-architecture
description: Draw the architecture a plan adds or changes as one mermaid flowchart for the plan's Prototype section. Use when a plan adds, removes or rewires components, services, stations or stores. Names come from the code, new parts are told apart from existing ones with a class, and the chart renders under mermaid's strict security level.
---

# Prototype: architecture

One mermaid `flowchart` that shows the parts the plan touches and what
talks to what. A reader should see in ten seconds what is new, what
changes and what stays.

## When to use

- The plan adds a service, a station, a job, a store or a queue.
- The plan moves a responsibility from one part to another.
- The plan adds a call, an event or a data path between parts.

Not for the order of steps in one request: that is a flow sketch.

## Method

1. List the parts the plan names. Find each in the checkout under
   /workspace/target (the app folder, the deploy chart, the package
   name) and use the name the code uses. Invent no name; a part the
   plan adds gets the name the plan gives it.
2. Keep the parts the change touches and the one part on either side
   of each, no more. About 12 nodes is the ceiling; split into two
   sketches rather than draw a wall.
3. Mark each node `new`, `changed` or leave it plain (existing,
   unchanged), with the classes below.
4. Label every edge with what crosses it: the protocol or the event,
   `HTTPS`, `"github.push"`, `SQL`.
5. Group by deployable or namespace with `subgraph` only when that
   grouping is part of the change.

## Format

- `format: "mermaid"`, `kind: "architecture"`, id `m-architecture-<n>`.
- Start with `flowchart LR` (or `TB` when the chain is long).
- `height`: about 60 px per rank, 240 to 520 for most charts.

## Rules that keep it rendering

The page renders with `securityLevel: "strict"` and
`flowchart.htmlLabels: false`. These break a chart:

- A label with punctuation, spaces around symbols, parentheses,
  slashes or colons that is not in double quotes: write
  `api["lore-api (REST)"]`, never `api[lore-api (REST)]`.
- HTML in a label (`<br>`, `<b>`): it prints as text or fails. Keep
  labels to one short line.
- A double quote inside a label: use single quotes inside instead.
- `end` as a node id (any case): it closes a subgraph. Use `done`.
- Ids that are not plain letters and digits: write `loreApi`, not
  `lore-api` or `lore.api`. Put the real name in the label.
- An id right after a link without a space: `a---ops` becomes a
  circle edge. Always put spaces around arrows: `a --> ops`.
- Two statements on one line or a trailing `;`: one statement per line.
- Edge labels with punctuation go in quotes: `a -->|"POST /api/plans"| b`.

## Classes

Put these two lines at the end of the chart, unchanged, so every
architecture sketch reads the same way:

```
classDef new fill:#e7f5ec,stroke:#1f7a3f,stroke-width:2px,color:#0b3d1f
classDef changed fill:#fff4e0,stroke:#b26a00,stroke-width:2px,color:#4a2c00
```

Then one `class` line per class, naming only ids the chart already
defines (an unknown id draws a stray node): `class planSketch new`,
`class stations,api changed`. Leave out a class line nothing uses.

## Worked example

Caption: `Sketch agent beside the planning agent`

```
flowchart LR
  web["web-ui plan page"] -->|"POST /prototype"| api["lore-api"]
  api -->|"node.sketch.start"| floor["external floor"]
  floor --> planSketch["plan-sketch agent"]
  planSketch -->|"lore_plan_edit add-mockup"| gateway["lore-mcp gateway"]
  gateway --> api
  floor --> stations["stations: plan-pass-end"]
  classDef new fill:#e7f5ec,stroke:#1f7a3f,stroke-width:2px,color:#0b3d1f
  classDef changed fill:#fff4e0,stroke:#b26a00,stroke-width:2px,color:#4a2c00
  class planSketch new
  class stations,api changed
```

Height 260.

## Help

<!-- lore-help:begin -->
**Summary.** Draw the components a plan adds or changes as one mermaid flowchart, new and changed parts marked, names from the code.
**Usage:** `/prototype-architecture`
**Use when.** A plan adds, removes or rewires services, stations, jobs or stores and its Prototype section needs an architecture sketch.
**Related:** `/prototype-flows`, `/prototype-data-model`
<!-- lore-help:end -->
