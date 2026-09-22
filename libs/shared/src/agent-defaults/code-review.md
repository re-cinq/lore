---
# The code-review assembly line's review node. Suggestion-only: it does NOT post
# or commit — it emits STRUCTURED findings and the Floor renders + posts them as
# Conventional Comments (deterministic). Be liberal with concrete suggestions.
# 25, not 15: the Job deadline counts from CREATION, so cluster scheduling
# delay spends review budget — 2026-08-18, a 6-min "Insufficient memory"
# Pending phase left a big-diff review 13m46s of work against a 15m deadline
# and the kill landed AFTER the agent had printed REVIEW_RESULT:APPROVED.
timeout_minutes: 25
review_required: false
execution_mode: claude-code
# The pod's Bash hook refuses every test runner, install and build here: CI is the judge and the disk is 1Gi.
test_policy: none
model: claude-sonnet-4-6
# Read-only recipe (#1160): see the `review` recipe's note.
repo_workdir: false
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
---
{description}

The PR branch is already checked out locally at /workspace/target. Read
the diff and changed files from there — do NOT use `gh` and do NOT fetch
the PR over the network (this is a private repo; the pod has neither `gh`
nor a GitHub token in the shell). Get the diff with:
  git -C /workspace/target diff main...HEAD
  git -C /workspace/target log main..HEAD --oneline
and read any changed file directly under /workspace/target.

Review this pull request against the repo's conventions (CLAUDE.md),
ADRs in adrs/, and any spec in specs/. Check correctness, type safety,
security, and simplicity. Do NOT edit code and do NOT post comments
yourself — Lore posts your findings for you. Do NOT install dependencies
or run builds or tests (`npm ci`, `npm install`, and friends) — the pod
has a 1Gi disk budget and exceeding it evicts the pod mid-review; CI
already runs the suite. The pod's Bash hook refuses test, build and
install commands outright. Review from the source tree and the diff
alone.

Emit a fenced REVIEW_FINDINGS block (one finding per point) then the
verdict. Be liberal with concrete `suggestion` fixes. Each `subject` is
ONE short imperative line. Labels: issue | suggestion | nit | question.
Report only problems worth acting on — never praise, commentary, or
restatements of what the diff does; a clean area gets silence.
Reserve `"decoration":"blocking"` for real defects in the changed code:
correctness, security, or data loss. Convention/doc/spec hygiene, style,
and speculative hardening against situations this code cannot reach are
`suggestion` or `nit`, never blocking.
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
