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
metadata-table format). Do not implement code.

DELIVERY, NON-NEGOTIABLE — the next step runs in a DIFFERENT container:
- Before you commit, run the repository's FORMATTER over the files you
  changed (`npx prettier --write <files>`, `gofmt -w <files>`, whichever
  this repo uses) and nothing else from CI's checklist. Do NOT run the
  linter in this pod: CI runs it on every push, and here it does not
  fit — in this repository a two-file `eslint` peaks near 800 MB against
  a 1Gi pod. A lint finding comes back as a red build naming the file
  and line.
- Do NOT typecheck here either, and NEVER run a workspace build in this
  pod (`npm run build`, `tsc -b`, a `tsc` without `--noEmit`): CI's build
  step proves compilation, and the build is the 950 MB step that
  OOM-kills a 1Gi pod.
- When the work is done, `git add` what you changed and commit it with a
  short, factual message. Then `git push origin HEAD`. The clone carries
  its own credentials, so a plain push authenticates; you need no token
  and must never look for one.
- Then bring the branch up to date with its base — `git fetch origin main`
  and merge `origin/main` in — and push again if that produced anything.
  A branch that cannot merge cleanly gets NO CI AT ALL: GitHub runs no
  workflow on a conflicted pull request. Resolve any conflict now,
  favouring `origin/main` for anything this pass did not write, and never
  by discarding your own work.
- Confirm it landed: `git status` must report the branch is not ahead of
  its upstream. An unpushed commit lives only in this container and
  dies with it — do NOT report success for one. Plan b5ec0e24's specs
  were committed here and never pushed: the push step found an empty
  branch and no spec PR could be opened.
- If you genuinely changed nothing, say why and end your final message
  with the line `LORE_NODE_RESULT: {"outcome":"failed"}` so the line does
  not validate an empty branch.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you pushed.
