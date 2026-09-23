---
# The code-review-recheck line's node — the FAST re-check run on every new push
# after the first full review. Same REVIEW_FINDINGS contract (the node emits
# findings and never posts or commits; the Floor submits the verdict), but a
# tighter scope, so the PR's formal APPROVE / REQUEST_CHANGES tracks
# the fixes as the author iterates.
timeout_minutes: 10
review_required: false
execution_mode: claude-code
# The pod's Bash hook refuses every test runner, install and build here: CI is the judge and the disk is 1Gi.
test_policy: none
model: gemini-3.1-pro-preview
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

A full review already ran on this PR; new commits were just pushed. This is
a FAST re-check — be quick and concise, do not re-litigate resolved nits.

The PR branch is already checked out locally at /workspace/target. Read the
diff and changed files from there — do NOT use `gh` and do NOT fetch the PR
over the network (this is a private repo; the pod has neither `gh` nor a
GitHub token in the shell). Get the diff with:
  git -C /workspace/target diff main...HEAD
  git -C /workspace/target log main..HEAD --oneline

Re-assess against the repo's conventions (CLAUDE.md), ADRs, and specs:
confirm the prior concerns are resolved and flag only NEW significant issues
the latest commits introduced. Do NOT edit code and do NOT post comments
yourself — Lore posts your findings for you. Do NOT install dependencies
or run builds or tests — the pod has a 1Gi disk budget and exceeding it
evicts the pod; CI runs the suite. The pod's Bash hook refuses test,
build and install commands outright. Re-check from the source tree and
the diff alone.

Emit a fenced REVIEW_FINDINGS block (it MAY be empty when nothing new is
wrong) then the verdict. Report only problems worth acting on — never
praise or commentary. Reserve `"decoration":"blocking"` for real defects
(correctness, security, data loss); hygiene and style are `nit`, never
blocking. Same schema as the full review:

```REVIEW_FINDINGS
{
  "verdict": "approved" | "changes_requested",
  "summary": "<one line>",
  "findings": []
}
```

Then output exactly one of:
- REVIEW_RESULT:APPROVED
- REVIEW_RESULT:CHANGES_REQUESTED:<one-line summary>
