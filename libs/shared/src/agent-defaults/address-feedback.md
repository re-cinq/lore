---
# The implementation line's `address` node (`prompt_ref: address-feedback`) —
# the second recipe the silent fallback hid (#1329). It ran `general` too, so a
# CHANGES_REQUESTED review sent the agent back in with "complete the following
# task" and the original spec, no idea that a reviewer had objected to anything.
timeout_minutes: 60
review_required: false
execution_mode: claude-code
model: claude-sonnet-4-6
---
A reviewer requested changes on the pull request for this work. Address
that feedback in the code, on the branch you are already on.

The review comments are in the Context section below, alongside the
original specification. Read the comments first, then the files they
refer to.

RULES:
- Change only what the feedback asks for. Unrelated edits make the
  re-review harder and are not what was requested.
- A comment you disagree with is still an answer you owe: make the
  change, or leave the code as it is and say plainly why, so the
  reviewer reads a reason rather than silence.
DELIVERY, NON-NEGOTIABLE — the next step runs in a DIFFERENT container:
- Before you commit, run the repository's FORMATTER over the files you
  changed (`npx prettier --write <files>`, `gofmt -w <files>`, whichever
  this repo uses) and nothing else from CI's checklist. Do NOT run the
  linter in this pod: CI runs it on every push, and here it does not
  fit — in this repository a two-file `eslint` peaks near 800 MB against
  a 1Gi pod, and runs 112256d9 and 62c1ca5e were OOM-killed on exactly
  that. A lint finding comes back as a red build naming the file and
  line, which the next round fixes with an editor.
- Do NOT typecheck here either. A green test is not a compiled build —
  vitest transpiles each file without checking types — but CI's build
  step is what proves it, and in this repository `tsc --noEmit` on
  `libs/shared` peaks near 950 MB against the 1Gi pod: run 2a291314's
  dod pod was OOM-killed on it. A type error comes back as a red build
  whose failed step and log tail name the file and line; the next
  round fixes it there. Read your imports and signatures twice instead.
- NEVER run a workspace build in this pod (`npm run build`, `tsc -b`, a
  `tsc` without `--noEmit`): tests resolve every workspace package from
  SOURCE, so nothing needs building for a test to see your change, and
  the build is the 950 MB step that OOM-killed run abac6ee9 while it
  rebuilt libs/shared for a test that never needed it.
- When the work is done, `git add` what you changed and commit it with a
  short, factual message. Then `git push origin HEAD`. The clone carries
  its own credentials, so a plain push authenticates; you need no token
  and must never look for one.
- Then bring the branch up to date with its base — `git fetch origin main`
  and merge `origin/main` in — and push again if that produced anything.
  A branch that cannot merge cleanly gets NO CI AT ALL: GitHub runs no
  workflow on a conflicted pull request, so the ticket parks on a build
  that will never start. Resolve any conflict now, favouring `origin/main`
  for anything this ticket did not write, and never by discarding your own
  work. This is why a nine-day-old branch stalled: 186 commits of drift,
  no checks, and a wait with nothing to wait for.
- Confirm it landed: `git status` must report the branch is not ahead of
  its upstream. An unpushed commit lives only in this container and
  dies with it — do NOT report success for one.
- If you genuinely changed nothing, say why and end your final message
  with the line `LORE_NODE_RESULT: {"outcome":"failed"}` so the line does
  not validate an empty branch.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you push.

Original specification: {description}
