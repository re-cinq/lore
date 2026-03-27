# Lore Research Charter

This file is the standing instructions for the weekly autoresearch
Klaus agent. It defines what the research system optimizes for, what
good context looks like, and what is out of scope. Platform engineers
update this file to steer the research system — they do not maintain
every piece of context directly.

## Metric

The fixed evaluation metric is the PromptFoo eval suite pass rate
across all team eval configs. A candidate context addition is
accepted if it improves the overall pass rate by >= 2 percentage
points compared to the current promoted Context Core.

The eval suite must have at least 10 test cases per team covering
their most critical conventions. Teams write their own test cases —
the platform team does not own domain knowledge.

## What good context looks like

Good context for Lore is:
- Specific and testable. "All monetary amounts are stored as integers
  in the smallest currency unit" not "we handle money carefully."
- Explains why, not just what. The reasoning behind a decision is
  more valuable than the decision itself.
- Scoped to a team or domain. Generic advice that applies to all
  software projects is noise.
- Under 1 page per topic. Concise beats comprehensive. If Claude Code
  needs more detail, it can follow the graph to the source PR or ADR.

## Entity types in scope

The ontology defines 8 entity types. The research system may propose
additions of any type:
- CLAUDE.md sections (team conventions, architectural contracts)
- ADR drafts (for decisions that exist in practice but aren't written up)
- Runbook additions (for incident types that have happened but aren't documented)
- Concept definitions (for domain terms that appear in code but aren't explained)

## Out of scope — never generate these

- PII (names, emails, phone numbers, addresses)
- Security credentials, API keys, tokens, or secrets
- Forward-looking business strategy or roadmap items
- Opinions about code quality or developer performance
- Content that requires access to systems the research agent cannot reach
- Speculative content ("this might be the case" — if unsure, flag for human review)

## Candidate generation strategy

For each gap cluster, generate 3 candidates using different approaches:
1. Direct statement: a clear rule or convention.
2. Example-based: a code example showing the right way.
3. Constraint-based: what NOT to do and why.

The eval suite determines which approach scores best. Over time, the
distribution of winning approaches tells us what style of context
our codebase responds to.

## Failure handling

If no candidate passes the 2% improvement threshold:
- Log all 3 attempts to BigQuery with their individual scores.
- Open a Beads task: "Manual intervention needed: [gap topic]"
- Include in the task: the three failed attempts, their scores, and
  the Langfuse queries that triggered the gap.
- A human reviews the failed attempts and either writes the context
  manually or decides the gap is acceptable.
