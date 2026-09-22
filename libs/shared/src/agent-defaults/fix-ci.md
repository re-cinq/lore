---
# The implementation-loop line's `fix-ci` and `repair-build` nodes. Reached
# only when a CI wait reported the branch RED. The pod has no `gh`: it reads
# CI's verdict from the section the Floor appends, or asks for it through the
# `lore_get_ci_failures` / `lore_get_ci_job_log` MCP tools. It never
# reproduces the build to learn what CI already printed — run 997026f5 did,
# and died at 1Gi on a one-line fix.
timeout_minutes: 45
review_required: false
execution_mode: claude-code
model: claude-sonnet-4-6
---
The pull request for this ticket has a RED build. Your job is to make it
green, on the branch you are already on, and nothing else.

CI is the judge of this branch, and the `CI reported failures` section
below is its verdict: the sha it judged, the checks that failed, and for
each — when CI published them — the annotations (`path:line message`),
the step that failed, and what it printed. Start from it, not from a
full local build.

WHEN THE VERDICT NAMES A FILE AND LINE — an annotation such as
`specs/x/spec.md:7 Status "draft" does not match ...` — open that file
at that line and fix what it says. Do not install dependencies, build
the workspace, or run the suite to confirm a finding CI already made
about a specific line; a lint or status error on a markdown file needs
an editor, not `npm ci`. Run a command only when the FIX needs one: a
test you must see fail, a typecheck of a package whose code you changed.

When it names the failed STEP and what that step printed but no
annotation, that is the diagnosis: find that step in
`.github/workflows/` and run only that step's command. When it names
only a check, map the check name to the job that publishes it, find the
command that job runs, and run ONLY that. Reproducing the whole build to
rediscover what you have already been told costs the ticket a pod and
tells you nothing new. The pod's Bash hook refuses a test runner given
no path, no workspace flag and no `cd` into the step's directory, so a
repo-wide `vitest run` never starts.

RUN A STEP'S COMMAND WHERE CI RAN IT, never from wherever your shell
happens to be. When the report says `Ran as: npm script <script> of
package <package>` (`npm_script` in `lore_get_ci_failures`), run
`npm run <script> -w <package>` from the repository root — or plain
`npm run <script>` if <package> is the root package.json's own name.
For any other step, take the directory from the workflow step itself
(its `working-directory:`, a `cd`, or a `-w`/`--prefix` in its `run:`).
A package's test command run at the repo root is NOT that command:
`npx vitest run` there discovers every package's suite. Run 754cb4fa ran
nine suites with coverage for 43 minutes and hit its deadline answering
what one package's suite answers in minutes.

NEVER RUN THE LINTER IN THIS POD, scoped or not. CI ran it on a machine
sized for it; here a two-file `eslint` peaks near 800 MB against a 1Gi
pod, and runs 112256d9 and 62c1ca5e were OOM-killed on it. When the red
check is a lint or format job, its findings are what you fix, not what
you reproduce: take the file and line from the annotation, or ask CI
with `lore_get_ci_failures` and then `lore_get_ci_job_log` with
`grep: "error"`. Format only the files this branch changed
(`git diff --name-only origin/main...HEAD`); typecheck nothing here —
CI's build step already did, and it does not fit this pod.

IF THE SECTION IS MISSING OR TOO THIN, ASK CI YOURSELF: call
`lore_get_ci_failures` with no arguments — it reports on the branch you
are on: the judged sha, the conclusion, and each failed check with its
annotations, failed steps and log tail. When a failure needs more of its
log, call `lore_get_ci_job_log` with that failure's `job_id`, a `grep`
for the report's error marker (`error`, `FAIL`, `✖`) and a small `tail`.
Never reinstall or rebuild the workspace to learn what CI already
printed.

FIRST, check the branch has not moved since CI judged it. The section's
heading names the sha CI read (`judged_sha` from `lore_get_ci_failures`
when the section is absent); run `git log --format=%s <that sha>..HEAD`.
If any commit it lists does not carry `[skip ci]`,
the branch moved after CI judged it: somebody pushed, and CI has not
judged the new head yet.
Change nothing and run nothing, and end with
LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Ci-Fixed":"branch moved past <sha>; CI re-judges the head"}}
The wait re-reads CI on the new head and sends the branch back here only
if that is red too.

BEFORE YOU READ ANY FILE, ask the graph what has failed here before.
For every path the red output names, call `lore-query-trace` with
`failures_touching` set to that path. Each row is a previous failed
attempt on that file: what failed, on which commit, and — when a later
attempt fixed it — the sha that did. `git show` that sha. This repo has
very likely hit this exact error before, and the diff that ended it last
time is the cheapest thing you will read today.

A row that says `still open` was never fixed; treat it as a warning that
the obvious fix did not work before, not as a solution to copy.

RULES:
- Fix EVERY finding the verdict names, in this visit, in the order
  listed. There is no local re-run here that would reveal the rest, and
  each finding you leave costs the ticket a round: run 2a291314's repair
  fixed one of three and the build came back red twice more. Do not add
  speculative fixes for failures the verdict did not name.
- Fix the cause, not the symptom. Never delete, skip, `.only`, `.todo` or
  loosen a test to go green; never widen a type to `any` to silence a
  typecheck error; never add an eslint-disable to pass lint. If the test
  is genuinely wrong, say why in your final message before you change it.
- Change only what the red build requires. Unrelated edits make the
  re-review harder and are not what was asked.
- If the named check's command passes locally, say exactly what you ran
  and what passed — the failure may be environment-only, and that is a
  finding, not a fix.

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
- If you changed nothing because the branch moved, end as the FIRST check
  above says. If you changed nothing for any other reason, say why and
  report `changes_requested` below, never `failed`: a failed repair ends
  the ticket, and the branch may already be green.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you push.

Print exactly one of these as the last line of your final message:
- You reproduced a failure, fixed it, and the build passes locally:
  LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Ci-Fixed":"<one line: what was broken>"}}
- You could not make it green, or the failure is not in this repository:
  LORE_NODE_RESULT: {"outcome":"changes_requested","extras":{"Lore-Ci-Blocked":"<one line: what you ran and what stayed red>"}}

Ticket: {description}
