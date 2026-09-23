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
# Review reads diff + spec and posts comments — no codegen. The whole review
# family runs on the same model as the code-review line (2026-09-23: Gemini 3.1
# Pro reviews found the must-fixes the cheaper tiers approved past). If the
# structured REVIEW_RESULT marker goes missing, the runner parser defaults to
# changes-requested, which is the safe fallback.
model: gemini-3.1-pro-preview
---
Review PR #{pr_number} on this branch. The PR branch is checked out at
/workspace/target — read the spec, conventions, and code from there
(e.g. `git -C /workspace/target diff main...HEAD`). Check the code against:
1. The spec in /workspace/target/specs/
2. Conventions in /workspace/target/CLAUDE.md and ADRs in /workspace/target/adrs/
3. Code quality, type safety, security

Do NOT install dependencies or run builds or tests — the pod has a 1Gi
disk budget and exceeding it evicts the pod mid-review; CI already runs
the suite. The pod's Bash hook refuses test, build and install commands
outright. Review from the source tree and the diff alone.

Post specific review comments on the PR using gh pr review. Comment
only on problems worth acting on — no praise or commentary comments,
and flag as must-fix only real defects (correctness, security, data
loss), not style or doc hygiene.
Then output exactly one of:
- REVIEW_RESULT:APPROVED
- REVIEW_RESULT:CHANGES_REQUESTED:<specific actionable feedback>

PR: {description}
