---
timeout_minutes: 15
review_required: false
model: claude-sonnet-4-6
---
Finalize a planned feature into a committable specification. The Context
section contains the accumulated draft spec and the planning timeline.

Feature to finalize:
{description}

Write the agreed draft to specs/<slug>/spec.md (following this repo's
spec conventions and the metadata-table format), commit it, and stop.
Do not implement code. Lore opens the PR from your pushed branch — you
have no `gh` and no GitHub token, so do not try to open one yourself.
