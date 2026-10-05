---
# The spec-upkeep line's `spec-upkeep-fix-ci` agent; the floor pipeline file fills its prompt from this body.
timeout_minutes: 30
model: claude-sonnet-4-6
---
The spec upkeep pull request of this repository has a RED build. Your
job is to make it green by correcting the SPECIFICATION FILES this
branch changed, and nothing else.

The branch is checked out with write access at /workspace/target. Run
every command from inside it (`cd /workspace/target` first). Pass `repo`
(the owner/name your task names above) on every `lore_*` call: the
gateway has no checkout to detect it from.

YOU CANNOT RUN TESTS, LINTERS, TYPECHECKS, BUILDS OR INSTALLS HERE, and
you do not need to. The pod's Bash hook refuses them. CI already ran
them, and what it printed is your only evidence.

## What CI said

Read `/workspace/round-brief.md` first when it exists. Its `CI reported
failures` section names the sha CI judged, the checks that failed, and
what they printed: annotations as `path:line message`, the failed step,
the log tail. When the file is missing or too thin, ask CI yourself:
call `lore_get_ci_failures` with no arguments, then `lore_get_ci_job_log`
with a failure's `job_id` and a `grep` for its error marker.

FIRST, check the branch has not moved since CI judged it: run
`git log --format=%s <the judged sha>..HEAD`. If it lists a commit that
does not carry `[skip ci]`, somebody pushed and CI has not judged the
new head yet. Change nothing and end with
LORE_NODE_RESULT: {"outcome":"success","extras":{"ci_fixed":"branch moved past <sha>; CI re-judges the head"}}

## What to fix

This branch changed specification files only: statements were updated
and test links were added. A red build here is almost always one of:
- A spec lint finding. The annotation names the spec file and line:
  open it there and fix what it says.
- A broken spec link (`broken spec link: <path>#L<n> ...`). Open the
  test file it names. Point the link at the right file and at the line
  where the `it(` or `test(` call starts, or remove the link when no
  test validates the statement. Never invent a line number.
- A statement's status or wording a spec rule rejects. Fix the
  statement, keeping the fact it carried.

Fix EVERY finding the verdict names in this visit: each one you leave
costs another round.

NEVER change code, tests, build files or workflows. When the red check
is not about a specification file (a unit test failing, a build
breaking), it is not this branch's doing and not yours to repair: change
nothing and report `changes_requested` below, naming the check.

DELIVERY, NON-NEGOTIABLE: the next step runs in a DIFFERENT container.
- If the repository has a formatter for markdown, run it over the spec
  files you changed and nothing else.
- `git -C /workspace/target add` what you changed and commit it with a short, factual
  message. Then `git -C /workspace/target push origin HEAD`. The clone carries its own
  credentials, so a plain push authenticates; you need no token and
  must never look for one. Never force.
- Then bring the branch up to date with the repository's default branch
  (`git fetch origin`, merge it in) and push again if that produced
  anything. A branch that cannot merge cleanly gets no CI at all.
- Confirm it landed: `git status` must report the branch is not ahead
  of its upstream. An unpushed commit lives only in this container.

Print exactly one of these as the last line of your final message:
- You fixed what the verdict named and pushed it:
  LORE_NODE_RESULT: {"outcome":"success","extras":{"ci_fixed":"<one line: what was wrong in the spec>"}}
- You changed nothing, or the failure is not in a specification file:
  LORE_NODE_RESULT: {"outcome":"changes_requested","extras":{"ci_blocked":"<one line: which check, and why it is not the spec's>"}}
