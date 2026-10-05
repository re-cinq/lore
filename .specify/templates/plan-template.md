<!-- Based on github/spec-kit v1.0.12 (e77daa9) templates/plan-template.md,
     adapted to this repository's spec standard (.lore/spec-standard.md).
     Diff against upstream when adopting a newer spec-kit release. -->

# Implementation Plan: [FEATURE NAME]

| Feature | [FEATURE NAME]        |
| ------- | --------------------- |
| Branch  | [feature-dir-slug]    |
| Spec    | [spec.md](./spec.md)  |
| Created | [DATE]                |

[One-paragraph summary: the primary requirement from ./spec.md and the
technical approach.]

<!-- RULES FOR FILLING THIS TEMPLATE (delete this comment block when done):
  - This file is the HOW. Every mechanism a ./spec.md requirement names in
    one line is elaborated here.
  - Statement-link and status lint do not govern this file, but
    no-dead-md-links does: only link files that exist (./spec.md,
    ./tasks.md); write code file paths as inline code, never links.
  - Same [NEEDS CLARIFICATION] discipline as the spec template: max 3
    working markers, all converted to plan questions + the spec's Open
    Questions before commit; zero survive in the committed file.
  - Delete unused sections. Keep a trailing newline. -->

## Technical Context

| Aspect               | Value                                             |
| -------------------- | ------------------------------------------------- |
| Language/Runtime     | [e.g. TypeScript ESM / Node 22]                   |
| Modules touched      | [e.g. `apps/floor`, `libs/assembly-lines`]        |
| Storage              | [tables/schemas touched, or N/A]                  |
| Testing              | [e.g. vitest via workspace-source aliases]        |
| Constraints          | [e.g. pod memory limits, timeouts]                |

## Constitution Check

<!-- One row per principle of .specify/memory/constitution.md. -->

| Principle     | Verdict          | Note                        |
| ------------- | ---------------- | --------------------------- |
| [principle 1] | PASS / DEVIATION | [why, if deviation]         |

## Mechanisms *(mandatory)*

<!-- The detail bar: every design question answerable from the approved plan
     and this codebase is answered HERE, so decomposition never guesses. -->

### Trigger wiring

[Which event or webhook, which handler, which listener file. E.g. the
lore-api's GitHub webhook route emits `github.issues.opened`; the Floor handler at
`apps/floor/src/events/...` reacts.]

### Data model

[Tables and columns (migration number if new), the assembly run's
subject/overlap key, new settings with their defaults (e.g.
`lore.repos.settings.…`).]

### Assembly-line graph

[Nodes and node types (agent / detect / service / label-webhook
choreography), every edge including FAILURE edges, iteration caps, timeout
minutes.]

### Gating

[Progressive-trust tier, per-repo opt-in setting, approval gates.]

### State/label taxonomy

[Every state or label this feature defines, reconciled with every metric
that consumes one — no SC may reference a state this table does not carry.]

## Failure Edges & Rollback

[What each failure outcome does to the walk, and how the feature is turned
off or rolled back.]

## Project Structure

```text
specs/[feature-dir-slug]/
├── spec.md    # WHAT — reviewed statements + success criteria
├── plan.md    # this file
└── tasks.md   # WORK — feeds decomposition
```

[Real source directories/files this feature touches, as a tree or list of
inline-code paths.]

## Complexity Tracking *(only when Constitution Check has deviations)*

| Deviation | Why needed | Simpler alternative rejected because |
| --------- | ---------- | ------------------------------------ |
| [...]     | [...]      | [...]                                |
