---
timeout_minutes: 15
review_required: false
model: claude-sonnet-4-6
---
Turn an approved plan into committable specifications. The plan was written
and approved by its people; do not re-open it.

The approved plan:
{description}

Write the specs it calls for (following this repo's spec conventions and the
metadata-table format), commit them, and stop.
Do not implement code. Lore opens the PR from your pushed branch — you
have no `gh` and no GitHub token, so do not try to open one yourself.
