---
name: lore-pr
description: Draft a PR description from spec, changed files, and ADR references. Reads everything automatically. Developer reviews once.
---

You are drafting a PR description. Read everything yourself. Do not ask the
developer to gather information.

## Read automatically (do not ask for any of this)

- Feature spec: find the relevant `specs/*/spec.md` from the branch name or
  changed files (look for the feature slug in the path)
- Changed files: `git diff --stat main` and `git diff main` (skim for key changes)
- ADRs referenced by the feature (check `adrs/` or `specs/*/research.md`)
- Task completion: check `specs/*/tasks.md` for what's done vs remaining
- Repo conventions: CLAUDE.md (if exists)

## Draft the description

Fill every section of the PR template (if `.github/PULL_REQUEST_TEMPLATE.md`
exists, follow its structure). Otherwise use:

```markdown
## Why
[What problem this solves — from spec problem statement]

## What Changed
[Summary of changes — from git diff analysis]

## Alternatives Considered
[From spec or research.md — what was rejected and why]

## ADRs & Architecture
[Any architectural decisions made or referenced]

## Spec
[Link to specs/{feature}/spec.md]

## Testing
[What was tested, how to verify]
```

Be specific. Write what a future engineer reading this in 18 months needs
to understand. Do not write "improves X" or "adds Y feature." Write what
problem it solves, what was rejected and why, what constraints shaped
the approach.

If no alternatives-rejected section exists anywhere, ask one question:
"What other approaches did you consider and why not?" Wait for the answer
before finishing.

## Output format

Show the complete draft in a code block so the developer can copy it.
After showing: "Does this look right? Anything to change?"

## After confirmation

Create the PR:
```bash
git push -u origin HEAD
gh pr create --title "..." --body "..."
```

## Help

<!-- lore-help:begin -->
**Summary.** Draft a PR description from the spec, the diff, and the ADRs the change touches.
**Usage:** `/lore-pr`
**Use when.** The branch is ready and you want a description that says what problem it solves and what was rejected, not "adds X feature".
**Not for.** Reviewing the change for defects, or judging whether it should merge.
**Examples**
- `/lore-pr` — reads the spec, `git diff main`, `tasks.md` and `adrs/`, drafts the full description, asks one round of edits, then pushes and opens the PR
- If nothing in the tree records what you rejected, it asks you exactly one question — "what other approaches did you consider?" — because that section cannot be inferred from a diff
**Related:** `/lore-feature`
<!-- lore-help:end -->
