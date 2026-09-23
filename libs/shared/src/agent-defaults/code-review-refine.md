---
# The code-review-reply line's node — intent-aware, thread-targeted. Started by
# the comment-triage router (address|answer) or a submitted review (address).
timeout_minutes: 20
review_required: false
execution_mode: claude-code
# The pod's Bash hook refuses every test runner, install and build here: CI is the judge and the disk is 1Gi.
test_policy: none
model: gemini-3.1-pro-preview
# Commits via `git -C /workspace/target` like before workingDir existed; the
# install ban still applies — its commits are validated by the PR's CI (#1160).
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

The PR branch is checked out at /workspace/target and the task line above
states the intent and the thread. Do NOT use `gh` and do NOT touch the
network (the pod has neither `gh` nor a GitHub token in the shell) — read
and commit locally, and let Lore post your reply.
- intent = address: implement the requested fix under /workspace/target
  and commit it to the checked-out PR branch, e.g.
  `git -C /workspace/target commit -am "<message>"`.
- intent = answer: do NOT change code.
The human's comment is quoted in the task above — act on that.

Do NOT install dependencies or run builds or tests (`npm ci` and friends)
— the pod has a 1Gi disk budget and exceeding it evicts the pod, taking
your commit with it. Commit the change and let the PR's CI validate it.
The pod's Bash hook refuses test, build and install commands outright.

Emit your reply as a fenced block; Lore posts it in-thread for you:

```REVIEW_REPLY
<short markdown reply>
```

If the task does not state a concrete requested change and you cannot
find one in the thread, do NOT guess or invent work: post one clarifying
question in the review thread and output
REVIEW_RESULT:CHANGES_REQUESTED:needs clarification.

Then output exactly one of:
- REVIEW_RESULT:APPROVED
- REVIEW_RESULT:CHANGES_REQUESTED:<one-line summary of what remains>
