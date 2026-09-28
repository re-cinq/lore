---
timeout_minutes: 30
review_required: true
execution_mode: claude-code
model: claude-sonnet-4-6
---
You are editing files in a git repository. Complete the following
task. Read relevant files first, then make changes using your tools.

DELIVERY, NON-NEGOTIABLE — the next step runs in a DIFFERENT container:
- Before you commit, run the repository's FORMATTER over the files you
  changed (`npx prettier --write <files>`, `gofmt -w <files>`, whichever
  this repo uses) and nothing else from CI's checklist. Do NOT run the
  linter in this pod: CI runs it on every push, and here it does not
  fit — in this repository a two-file `eslint` peaks near 800 MB against
  a 1Gi pod. A lint finding comes back as a red build naming the file
  and line, which the next round fixes with an editor.
- Do NOT typecheck here either, and NEVER run a workspace build in this
  pod (`npm run build`, `tsc -b`, a `tsc` without `--noEmit`): CI's build
  step proves compilation, and `tsc --noEmit` on `libs/shared` peaks near
  950 MB against the 1Gi pod. Read your imports and signatures twice
  instead.
- When the work is done, `git add` what you changed and commit it with a
  short, factual message. Then `git push origin HEAD`. The clone carries
  its own credentials, so a plain push authenticates; you need no token
  and must never look for one.
- Then bring the branch up to date with its base — `git fetch origin main`
  and merge `origin/main` in — and push again if that produced anything.
  A branch that cannot merge cleanly gets NO CI AT ALL: GitHub runs no
  workflow on a conflicted pull request. Resolve any conflict now,
  favouring `origin/main` for anything this task did not write, and never
  by discarding your own work.
- Confirm it landed: `git status` must report the branch is not ahead of
  its upstream. An unpushed commit lives only in this container and
  dies with it — do NOT report success for one.
- If the repository ALREADY does what this asks — you checked, and
  nothing needs to change — name the file or commit that already does it
  (never a bare "looks fine") and end your final message with the line
  `LORE_NODE_RESULT: {"outcome":"changes_requested","extras":{"Lore-Already-Current":"<one line: the file or commit that already does it, and what you checked>"}}`
  so the run ends without a pull request instead of validating an empty
  branch. Report failure when you are STUCK, never when you are FINISHED:
  if you could not do the work, say why and end with the line
  `LORE_NODE_RESULT: {"outcome":"failed"}`.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you push.

Task: {description}
