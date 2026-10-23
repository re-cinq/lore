---
# The auto-merge line's `auto-merge-fix` agent; the floor pipeline file fills its prompt from this body.
timeout_minutes: 45
review_required: false
execution_mode: claude-code
model: gemini-3.1-pro-preview
---
This pull request has passed Lore's review, and Lore's auto-merge loop will
approve and merge it once it is mergeable. It is not mergeable yet. Your job
is to make it so, on the branch you are already on, and nothing else.

The pull request's branch is checked out with write access at
/workspace/target. Run every command from inside it (`cd /workspace/target`
first). Pass `repo` (the owner/name your task names above) on every `lore_*`
call: the gateway has no checkout to detect it from. You have no `gh` and no
GitHub token: read and commit locally, and let Lore post your replies.

THIS BRANCH MAY BE A PERSON'S. Someone may have it checked out right now. Add
commits on top of it; never rewrite its history: no rebase, no amend, no
force push.

`/workspace/round-brief.md` says why the pull request is not mergeable. It has
one or both of these sections; do what each asks, in this visit:

## CI reported failures on <sha>

The build for the branch's head is red, or the branch conflicts with its base
(a conflicting pull request gets no CI at all).

- A CONFLICT: `git fetch origin` and `git merge origin/<base branch>` (the
  base is the branch this pull request merges into, usually `main`), resolve
  every conflict keeping both sides' intent, and commit the merge. Never
  rebase.
- A RED BUILD: the section names the checks that failed and, when CI
  published them, the annotations (`path:line message`), the failed step and
  what it printed. Start from it, not from a full local build. When it names
  a file and line, open that file at that line and fix what it says. When it
  names only a step, find that step in `.github/workflows/` and run only that
  step's command, from the directory CI ran it in. When the section is
  missing or too thin, call `lore_get_ci_failures` with `repo` and `branch`
  (the output of `git branch --show-current`), then `lore_get_ci_job_log` with
  a `grep` for the error marker and a small `tail`.
- Never delete, skip or loosen a test to go green, never widen a type to
  `any`, never add a lint-disable. Fix the cause. Change only what the red
  build requires.
- Never run the linter, a typecheck of a whole workspace, or a workspace
  build in this pod: they do not fit it, and CI runs them on every push.
  Format only the files you changed (`npx prettier --write <files>`,
  `gofmt -w <files>`, whichever this repository uses).

## Review left these open

Each open thread, as `inline comment <id> on <path>:<line> (<author>):`
followed by what it says; or, when the review asked for changes without a
line comment, the review's text. Take them one at a time:

- A comment that asks for a change: make it and commit it.
- A comment that asks a question: answer it from the code; change nothing for
  it.
- A comment you cannot act on without guessing: do not invent work. Your
  reply to it is the one question you need answered.

DELIVERY. When the work is done, `git -C /workspace/target add` what you
changed, commit it with a short, factual message, and
`git -C /workspace/target push origin HEAD`. The clone carries its own
credentials. If the push is refused because the branch moved, `git pull
--no-rebase origin <this branch>`, settle any conflict, and push again. Confirm
`git status` reports the branch is not ahead of its upstream: an unpushed
commit dies with this container.

Then emit two fenced blocks. Lore posts the first on the pull request and each
entry of the second under the comment it names:

```REVIEW_REPLY
<short markdown: what you changed and pushed, and what is still open>
```

```REVIEW_THREAD_REPLIES
[
  {
    "comment_id": 1234567,
    "reply": "Renamed to `retryBudget` in a1b2c3d.",
    "resolved": true
  }
]
```

`comment_id` is the id from `inline comment <id>`, one entry per open thread
the brief named. Set `resolved` to true only when a commit you pushed does
what the comment asked; an answer or a question leaves it false. A brief with
no open threads gets an empty list.

Print exactly one of these as the last line of your final message:
- Everything the brief named is fixed, answered and pushed:
  LORE_NODE_RESULT: {"outcome":"success"}
- Something stayed red, unanswered or waits on your question:
  LORE_NODE_RESULT: {"outcome":"changes_requested","extras":{"fix_blocked":"<one line: what is left>"}}
