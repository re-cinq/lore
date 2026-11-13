---
name: prototype-data-model
description: Draw the tables or records a plan adds or changes as one mermaid entity-relationship diagram for the plan's Prototype section. Use when a plan adds or changes stored data, tables, columns, documents, links between records. Fields carry types, existing fields appear only where the change touches them, and the diagram renders under mermaid's strict security level.
---

# Prototype: data model

One mermaid `erDiagram` of the records the plan adds or changes, their
fields with types, and how they link. A reader sees what will be
stored and what points at what.

## When to use

- The plan adds a table, a column, a document shape or a settings key.
- The plan links two records that were not linked, or splits one.

Not for how data moves between services: that is an architecture or a
flow sketch.

## Method

1. Find the current shape in /workspace/target: the migrations folder,
   the schema or model files, the ORM entities. Use the table and
   column names they use.
2. Draw each table the plan adds, with every field.
3. Draw each table the plan changes, with its key, the fields the
   change adds or alters, and the fields a new link uses. Leave the
   rest out: the sketch is about the change.
4. Draw an unchanged table only when a new link points at it, with
   its key alone.
5. Mark new fields with the comment `"new"` and changed ones with
   `"changed"`.

## Format

- `format: "mermaid"`, `kind: "data-model"`, id `m-data-model-<n>`.
- `height`: about 30 px per field plus 60 per table row of the layout;
  240 to 600 for most.

## Rules that keep it rendering

- Entity names are letters, digits, `_` and `-`: `plan_versions`. A
  schema prefix goes in the name with `_`, never a dot:
  `lore_plans`, not `lore.plans`.
- A field line is `type name` with optional `PK`, `FK`, `UK` and a
  quoted comment: `uuid plan_id FK "new"`.
- The type is one word of letters, digits and `_`: `text`, `uuid`,
  `int`, `jsonb`, `timestamptz`, `bool`. Write an array as
  `text_array`, never `text[]`; a length as `varchar`, never
  `varchar(255)`.
- Relationship labels are quoted: `plans ||--o{ plan_versions : "keeps"`.
- Cardinality marks: `||` exactly one, `o|` zero or one, `}|` one or
  more, `o{` zero or more.
- One statement per line, no HTML, no `;`.

## Worked example

Caption: `A sketch stored as a block of the plan`

```
erDiagram
  plans ||--o{ plan_versions : "keeps"
  plans ||--|| plan_state : "holds"
  plans {
    uuid id PK
    text repo
    text status
  }
  plan_state {
    uuid plan_id PK
    bytea doc "changed"
  }
  plan_versions {
    uuid id PK
    uuid plan_id FK
    int version
    jsonb snapshot "changed"
  }
```

Height 360.

## Help

<!-- lore-help:begin -->
**Summary.** Draw the tables or records a plan adds or changes as a mermaid erDiagram with typed fields and their links.
**Usage:** `/prototype-data-model`
**Use when.** A plan adds or changes stored data and its Prototype section needs a data-model sketch.
**Related:** `/prototype-architecture`, `/prototype-states`
<!-- lore-help:end -->
