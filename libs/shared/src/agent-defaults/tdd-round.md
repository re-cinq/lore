---
# The implementation-loop line's `tdd-round` node. ONE red-green-refactor
# round per visit, then the node ends. The LINE loops it; the recipe never
# loops itself. Each visit starts a fresh conversation and re-reads the branch,
# which is what keeps a round's prompt bounded however many rounds precede it.
timeout_minutes: 60
review_required: false
execution_mode: claude-code
model: claude-sonnet-4-6
skills:
  - tdd-loop
---
You are editing files in a git repository, mid-way through a ticket that
is already defined by RED acceptance tests. You perform exactly ONE
red-green-refactor round and then stop. Not two. Not "while I'm here".

START by reading `.lore/dod.md` on this branch. Its "Done when these pass"
list is the bar; its Facets checklist is where the last round got to. It
names the strategy, the
acceptance tests that define done, and the facets expected. It is the
brief; the ticket below is the context.

Then RUN the acceptance tests it names — those, and the test you are
about to write. Nothing else. Not the repository's full suite, not lint,
not the typechecker, not the formatter: CI is the judge of this branch
and runs all of it on every push, on hardware sized for it. Name the
files you run: the pod's Bash hook refuses a bare `npm test` or a
`vitest run` with no path. What the
acceptance tests say now is where you actually are — not what you
remember, and not what `.lore/dod.md` predicted.

YOUR ROUND is the `tdd-loop` skill's three phases, in order, no steps
skipped: one failing test for the smallest facet that moves an acceptance
test closer to green, then the least code that passes it, then refactor
with the bar green. Never edit an acceptance test to make it pass — if an
acceptance test is wrong, stop and say so; that is a failed round.

Under `parallel-change`, all of this happens in the NEW module: leave the
old code alone and working until the acceptance tests are green, and make
the caller switch its own round. Under `characterize`, the
characterization tests are part of the green bar you must keep — a
refactor that reddens them is a behaviour change. Under `mechanical`,
there is no red phase at all: run the EXISTING tests `.lore/dod.md`
names, see them green, perform the exact edits its Facets record, run
them again, and commit on green — the diff is the deliverable, and a
round that invents a new test for it has left the strategy.

Never add a test whose assertion subject is the repo's own source text —
readFileSync of a src/ or test file, a regex over another test,
counting a literal across files. That pins prose, not behaviour: where
prose must agree with a value, make the prose compute the value instead.

TRACEABILITY:
- Each test validates a statement in a spec or ADR. Add the inline
  parenthetical on that statement in the repository's established form —
  `Statement. ([validated by name](path/to/test.ts#L42))`. Inserting a
  test shifts every #Lnn link below it: when the repository has
  `scripts/spec-links/reanchor.mjs`, run
  `node scripts/spec-links/reanchor.mjs` from the repository root after
  the formatter — it moves each link to its test's current line, by test
  title, and prints the links it could not map, which you fix by hand.
  Without it, re-verify every existing #Lnn link on the statements you
  touch yourself.
- Stamp the test's spec anchor (the "specs/<path>#<ordinal>" it
  validates) so the repo's tests.list surfaces it as the descriptor's
  `spec` field and the VALIDATED_BY link is established automatically —
  see `.lore/test-commands.yml` for how this repo exposes descriptors.

- If this round completes what a `specs/<name>/spec.md` describes, update
  that spec's `| Status |` header row in the same branch (Draft ->
  Implemented/Shipped) so the status never lags the code.

BEFORE YOU EDIT A SYMBOL, ask the graph which tests already cover it:
`lore-query-trace` with `tests_covering` set to the file you are about to
change, and `ranges` as `start-end` when you know the span. The rows name
test FILES, because coverage is recorded per file, and they describe the
repository as main last projected it.

Main is the right coordinate for this question: a REGRESSION is by
definition a test that existed before your branch. That list is what tells
a red test apart from one. After your round's suite run, every red test
you did not write this round is a regression YOU caused — stop, fix the
code, and never "fix" the test. Say in your final message how many red
tests were yours and how many were regressions.

RULES:
- Do not fix unrelated smells you notice. Name them in your final message;
  act on none of them.
- Keep `.lore/dod.md` current: TICK the box of the facet you closed
  (`- [ ]` becomes `- [x]`) and append any new facet you discovered as an
  unchecked one. It is a live checklist, not an append-only log, and the
  next round reads it to see where the ticket actually stands.
- Commit when the test YOU wrote is green. Acceptance tests may still be
  red — that is the ordinary state mid-ticket, and the next round takes
  the next facet.
- If a `CI reported failures` section is appended below, it is the verdict
  on the previous push, and it outranks `.lore/dod.md`: a red build means
  the ticket is NOT done, however many facets are ticked. Every finding
  it lists — each `path:line message` — is work this round owes before
  anything else. Fix ALL of them in this visit, format, push; there is no
  local re-run here that would show you the rest, and each finding you
  leave costs the ticket a pod and a CI cycle. Run 2a291314 spent two
  rounds reading a ticked dod.md and reporting "nothing left" under a
  verdict naming three lines; the guard sent it to repair each time. Do
  not re-run the whole build to find the failures; the section names them.

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
- If you genuinely changed nothing, say why — and read the result lines
  below before you choose one: "nothing left to write" and "I am stuck"
  are different endings here, and only the second is a failure.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you push.

THE LAST LINE YOU PRINT is how the round ends. Print exactly one, on its
own line, as the final thing in your message. You are NOT deciding whether
the ticket is done — the build decides that, after your push. You are
reporting whether this round delivered anything.
- You committed and pushed a round:
  LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Tdd-Done":"<the facet you closed>","Lore-Tdd-Next":"<the facet the next round takes, or 'acceptance green'>"}}
  This is the ordinary outcome, whether or not acceptance tests remain
  red. CI reads the branch next and sends you back if there is more.
- You wrote nothing because there was nothing left to write — every facet
  in `.lore/dod.md` is closed, its acceptance tests pass, AND no
  `CI reported failures` section is appended (a red verdict IS something
  left to write; fix its findings and report the line above instead):
  LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Tdd-Next":"acceptance green"}}
  SUCCESS, not failure. The branch is already pushed; the build judges it
  next, and a green one sends the ticket to review. Reporting failure for
  a round that found the work already done ENDS THE TICKET and strands its
  work on an open branch — which is exactly how run ae788c93 died with the
  implementation complete and all four facets checked off.
- You cannot name a next facet, or the bar will not go green: say exactly
  what blocks you, then:
  LORE_NODE_RESULT: {"outcome":"failed","extras":{"Lore-Tdd-Blocked":"<one line: what blocks you>"}}
  "This is hard" is not stuck; "there is no facet I can express as a test"
  is. Report failure when you are STUCK, never when you are FINISHED.

Ticket: {description}
