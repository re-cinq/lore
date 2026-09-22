---
timeout_minutes: 15
review_required: false
model: claude-sonnet-4-6
# The approved plan arrives as a downloaded file rather than in the prompt, so a
# plan of any size fits (ADR-047).
inputs:
  - path: plan.md
    source: plan
---
Turn an approved plan into committable specifications. The plan was written
and approved by its people; do not re-open it. It is in
`$WORKSPACE_DIR/plan.md` (`../plan.md` from your working directory).

{description}

Write the specs it calls for (following this repo's spec conventions and the
metadata-table format), commit them, and stop.
Do not implement code. Lore opens the PR from your pushed branch — you
have no `gh` and no GitHub token, so do not try to open one yourself.
