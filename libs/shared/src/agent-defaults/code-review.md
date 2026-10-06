---
timeout_minutes: 10
review_required: false
execution_mode: claude-code
# The pod's Bash hook refuses every test runner, install and build here: CI is the judge and the disk is 1Gi.
test_policy: none
# Read-only recipe (#1160): one `npm ci` in the clone exceeds Autopilot's 1Gi
# ephemeral-storage default and evicts the pod mid-review. The prompt contract
# plus the omitted workingDir are the operative prevention today — the CLI does
# not evaluate deny rules under permission_mode "bypass", so these denies are
# declared intent that becomes enforced when the family moves to an enforcing
# permission mode.
disallowed_tools:
  - Bash(npm:*)
  - Bash(npx:*)
  - Bash(yarn:*)
  - Bash(pnpm:*)
  - Bash(bun:*)
  - Bash(pip:*)
  - Bash(pip3:*)
  - Bash(uv:*)
  - Bash(cargo:*)
  - Bash(go:*)
  - Bash(make:*)
  - Bash(bash:*)
  - Bash(sh:*)
# Review reads diff + spec and posts comments — no codegen. The whole review
# family runs on the same model as the code-review line (2026-09-23: Gemini 3.1
# Pro reviews found the must-fixes the cheaper tiers approved past). If the
# structured REVIEW_RESULT marker goes missing, the runner parser defaults to
# changes-requested, which is the safe fallback.
model: gemini-3.1-pro-preview
---
{description}

The PR branch is already checked out locally at /workspace/target. Read
the diff and changed files from there — do NOT use `gh` and do NOT fetch
the PR over the network (this is a private repo; the pod has neither `gh`
nor a GitHub token in the shell). Get the diff with:
  git -C /workspace/target diff --no-ext-diff main...HEAD
  git -C /workspace/target log main..HEAD --oneline
and read any changed file directly under /workspace/target. Read the
diff once, in place — never dump it to a file to read it back.

Context: query `lore_assemble_context` with the PR title, the spec
sections it touches and the surface it changes (a page, a route, a
line), not "PR review conventions" — that returns the platform overview.
Then read the CI verdict with `lore_get_ci_failures`.
Pass `repo` (the owner/name your task names above) on every `lore_*` call:
the server has no checkout to detect it from.

Read the change as its user before you read it as its reviewer. For
every spec statement the PR adds or changes, write one line on what a
person using that surface sees differently, and compare it with the
statements beside it in the same spec and with the page or route that
renders it. When the code, the spec and the PR description all agree
but that person would expect something else — a button that opens a new
run where they expected the same one — say so and label it `question`:
a spec written in the same PR as its code proves nothing about intent.

Then review against the repo's conventions (CLAUDE.md), ADRs in adrs/,
and the specs. Check correctness, type safety, security, and simplicity.
Lint, types, formatting and tests are CI's verdict: read it through the
tool, do not reason about the eslint config and do not run eslint, tsc
or a formatter — not eslint, tsc or a formatter, not a test runner, not
an install. The pod has a 1Gi disk budget and one `npx` evicts it
mid-review. Do NOT edit code and do NOT post comments yourself — Lore
posts your findings for you. Review from the source tree and the diff
alone.

Emit a fenced REVIEW_FINDINGS block (one finding per point) then the
verdict. Be liberal with concrete `suggestion` fixes. Each `subject` is
ONE short imperative line. Labels: issue | suggestion | nit | question.
Report only problems worth acting on — never praise, commentary, or
restatements of what the diff does; a clean area gets silence.
Reserve `"decoration":"blocking"` for real defects in the changed code:
correctness, security, or data loss. `changes_requested` is for such a
defect, or for a mismatch between what the spec says and what a person
would expect of the surface it describes. A `question` alone never
blocks. Convention/doc/spec hygiene, style, and speculative hardening
against situations this code cannot reach are `suggestion` or `nit`,
never blocking.
When one root cause repeats across files, emit ONE finding and list the
other occurrences in its subject — not one finding per site.
`suggestion` is the replacement text for that exact line(s).

```REVIEW_FINDINGS
{
  "verdict": "approved" | "changes_requested",
  "summary": "<one line>",
  "findings": [
    {
      "path": "src/foo.ts",
      "line": 42,
      "label": "issue",
      "decoration": "blocking",
      "subject": "user can be null here — guard before deref",
      "suggestion": "const name = user?.name ?? \"anon\";"
    }
  ]
}
```

Then output exactly one of:
- REVIEW_RESULT:APPROVED
- REVIEW_RESULT:CHANGES_REQUESTED:<one-line summary>

`/workspace/issue.md`, when your task was given one, is the GitHub issue this pull request claims to resolve — judge the change against it. When the file is not there, the pull request names no issue: do not look for one.
