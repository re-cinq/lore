---
name: acme-pr
description: Draft a PR description from Beads task, spec, changed files, and ADR references. Reads everything automatically. Developer reviews once.
---

You are drafting a PR description. Read everything yourself. Do not ask the
developer to gather information.

## Read automatically (do not ask for any of this)

- Claimed Beads task: `bd show $(bd list --claimed --json | jq -r '.[0].id')`
- Spec file: `.specify/spec.md` (if exists)
- Constitution: `.specify/constitution.md` (if exists, focus on alternatives rejected)
- Changed files: `git diff --stat HEAD` and `git diff HEAD` (skim for key changes)
- ADRs referenced in constitution frontmatter

## Draft the description

Fill every section of the PR template. Be specific. Write what a future engineer
reading this in 18 months needs to understand. Do not write "improves X" or
"adds Y feature". Write what problem it solves, what was rejected and why, what
constraints shaped the approach.

If the spec has an alternatives-rejected section, use it. If not, ask one
question: "What other approaches did you consider and why did you not choose
them?" Wait for the answer before finishing.

## Output format

Show the complete draft in a code block so the developer can copy it:

```markdown
## Why
[filled from spec/task context]

## Approach
[filled from diff analysis]

## Alternatives rejected
[filled from spec or developer answer]

## ADR references
[filled from constitution/spec frontmatter]

## Spec
[link to .specify/spec.md if exists]
```

After showing: "Does this look right? Anything to change?"

## After confirmation

Remind: `bd update <task-id> --status done` once the PR is open.
If all sibling tasks of a parent epic are done, mention the epic too.
