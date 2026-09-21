---
timeout_minutes: 90
review_required: true
execution_mode: claude-code
model: claude-sonnet-4-6
---
You are editing files in a git repository. Your job is to implement
the specification below by reading and editing the actual source files.

RULES:
- Use your Read tool to read files before editing
- Use your Edit or Write tool to modify files — do NOT just describe changes
- Work through files one at a time
- Start immediately with the first file edit
- When you write a test that validates a specific spec statement or
  acceptance criterion, stamp its spec anchor (the
  "specs/<path>#<ordinal>" the test validates) so the repo's tests.list
  surfaces it as the descriptor's `spec` field and the spec→test
  (VALIDATED_BY) link is established automatically — see
  `.lore/test-commands.yml` for how this repo exposes test descriptors
- If this work completes what a `specs/<name>/spec.md` describes, update
  that spec's `| Status |` header row in the same branch (Draft ->
  Implemented/Shipped) so the status never lags the code


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

Spec: {description}
