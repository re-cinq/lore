<!-- Based on github/spec-kit v1.0.12 (e77daa9) templates/spec-template.md,
     adapted to this repository's spec standard (.lore/spec-standard.md).
     Diff against upstream when adopting a newer spec-kit release. -->

# Feature Specification: [FEATURE NAME]

| Feature | [FEATURE NAME]              |
| ------- | --------------------------- |
| Branch  | [feature-dir-slug]          |
| Status  | Draft                       |
| Created | [DATE]                      |
| Owner   | [owning team]               |

[Intro paragraph — one or two sentences saying what this feature is, BEFORE
the first `##` heading. CI errors without it.]

<!-- RULES FOR FILLING THIS TEMPLATE (delete this comment block when done):
  - A NEW spec is ALWAYS `Status: Draft` — it has no ([validated by](…)) test
    links yet, and CI ties Status to link coverage. Never write In Progress
    or Shipped here.
  - Never include example ([validated by](…#Lnn)) anchors: the anchor checker
    and the status ladder both read them as real.
  - Never emit a markdown link to a file that does not exist (CI:
    no-dead-md-links). Write code file paths as inline code, not links.
  - [NEEDS CLARIFICATION: …] markers are WORKING NOTES. Maximum 3, reserved
    for choices that change scope, security or user experience and have no
    reasonable default (document defaults you chose under Assumptions
    instead). Before committing, convert every remaining marker into BOTH a
    plan question (spec-review-result.json plan_questions) AND an Open
    Questions bullet naming the real alternatives — a committed file contains
    ZERO `[NEEDS CLARIFICATION` strings.
  - Every statement under Requirements is testable and names its concrete
    mechanism (event, webhook, handler, table, YAML node, setting) in one
    line; the mechanism's elaboration lives in ./plan.md. A requirement that
    cannot name its mechanism moves to Open Questions.
  - Narrative sections (Problem Statement, Assumptions, Open Questions) are
    exempt from statement-link lint; requirements are not.
  - Delete optional sections you do not use. Keep a trailing newline. -->

## Problem Statement

[What hurts today and why this feature exists — narrative, no requirements
here.]

## User Scenarios *(mandatory)*

<!-- Stories are PRIORITIZED user journeys. Each must be INDEPENDENTLY
     testable: implementing only P1 still yields a viable MVP slice. -->

### User Story 1 - [Brief Title] (Priority: P1)

[The journey in plain language.]

**Why this priority**: [value]

**Independent Test**: [how this story is verified on its own]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

### User Story 2 - [Brief Title] (Priority: P2)

[...]

### Edge Cases

- [boundary condition and what happens]
- [error scenario and how the system responds]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: [Testable statement naming its mechanism, e.g. "The Floor
  applies the label on the `github.issues.opened` event via the
  webhook-ingress handler"]
- **FR-002**: [...]

### Key Entities *(only if the feature involves data)*

- **[Entity]**: [what it represents; table/columns named, elaborated in
  ./plan.md]

## Success Criteria *(mandatory)*

<!-- Measurable, technology-agnostic. Map 1:1 from the approved plan's KPIs:
     every plan KPI becomes an SC-nnn below OR is listed under "Dropped"
     with the reason. A criterion may only reference states/labels this spec
     defines. -->

- **SC-001**: [measurable outcome, e.g. "80% of issues reach a verdict
  without human intervention"]
- **SC-002**: [...]

**Dropped from the plan's KPIs**: [KPI name — reason], [...]

## Assumptions

- [Reasonable default chosen where the plan did not specify, with the choice
  stated]

## Open Questions

<!-- Narrative-exempt. The approved plan's open questions are copied here
     VERBATIM with the real alternatives named — never answered for the
     author. Converted [NEEDS CLARIFICATION] markers also land here. -->

- **[Question]** — Choices: [option A], [option B]. [Why it is open.]
