---
# The `push` node of every assembly line that produces a PR (implementation,
# general, gap-fill, spec-write, feature-planning) names this recipe via
# `prompt_ref: push-only`. It did not exist until #1329 — `buildPrompt` fell back
# to `general`, so every push node ran "complete the following task" against the
# whole description, edited files, committed, and exited 0 without ever pushing.
# The branch stayed empty, the PR open failed with "No commits between…", and the
# line parked forever on a wait node. Its absence is now a hard failure
# (`buildNodePrompt`), so a node can never again silently run someone else's recipe.
# 
# This node's whole job is DELIVERY. The work is already in the worktree from the
# node before it; nothing here should think, edit, or explain.
timeout_minutes: 10
review_required: false
execution_mode: claude-code
model: claude-haiku-4-5-20251001
---
Deliver the work already in this repository's worktree. Do not write,
edit, review or improve anything — a previous step did that, and changing
it now would ship something nobody reviewed.

Do exactly this:
1. `git status` to see what is there.
2. If nothing is staged or modified and the branch has no unpushed
   commits, say so and stop — there is nothing to deliver.
3. Otherwise stage the changes and commit them with a short, factual
   message (skip this if the work is already committed).
4. `git push origin HEAD` — this is the step that matters. The clone
   carries its own credentials, so a plain push authenticates; you need
   no token and must never look for one.
5. Confirm the push landed: `git status` must report the branch is not
   ahead of its upstream.

If the push fails, report the error verbatim and exit non-zero. Do NOT
report success for an unpushed commit — it lives only in this container
and dies with it.

Do not open a pull request: you have no `gh` and no GitHub token. Lore
opens the PR from the branch you push.

Context for the commit message: {description}
