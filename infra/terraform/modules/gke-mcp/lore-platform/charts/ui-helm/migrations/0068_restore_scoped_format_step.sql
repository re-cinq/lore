-- Put the linter back in the pod, scoped (specs/implementation-loop FR14).
--
-- 0067 removed "run the repository's OWN format/fix step" from every delivering
-- recipe. That was justified by pod cost, but the cost argument was about the
-- TEST SUITE, which takes minutes and belongs on CI; it was applied to lint and
-- formatting, which take seconds over the files a round changed. The first live
-- ticket (#1914) then ran four rounds without going green, failing every round
-- on `format`, and its pods made 83 Bash calls without once invoking a linter.
-- A red round costs a pod relaunch plus a CI cycle; `eslint --fix` costs
-- seconds. This restores the step, scoped to changed files this time.
--
-- FIVE recipes, not seven: `tdd-round` and `fix-ci` carry a NULL prompt on their
-- rows and resolve from the yaml baked into the image, so rewriting them here
-- would be a no-op dressed as a change. Same conditional shape as 0067 — only
-- rows still carrying the prior text are rewritten, and only rewritten rows
-- emit a catalog event.

WITH updated AS (
UPDATE lore.agent_definitions
   SET prompt = $lore_mig$You are editing files in a git repository. Your job is to implement
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
- Before you commit, run the repository's own fix/format step OVER THE
  FILES YOU CHANGED — not the whole repo (`npx eslint --fix <files>`,
  `gofmt -w <files>`, whichever this repo uses). Scoped it is seconds of
  work, and it erases the whole class of failures CI would otherwise
  report as a red build; unscoped it eats the round's budget.
- When the work is done, `git add` what you changed and commit it with a
  short, factual message. Then `git push origin HEAD`. The clone carries
  its own credentials, so a plain push authenticates; you need no token
  and must never look for one.
- Confirm it landed: `git status` must report the branch is not ahead of
  its upstream. An unpushed commit lives only in this container and
  dies with it — do NOT report success for one.
- If you genuinely changed nothing, say why and end your final message
  with the line `LORE_NODE_RESULT: {"outcome":"failed"}` so the line does
  not validate an empty branch.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you push.

Spec: {description}$lore_mig$,
       updated_at = now()
 WHERE name = 'implementation'
   AND prompt IS NOT NULL
   AND prompt NOT LIKE '%fix/format step OVER THE%'
 RETURNING project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT 'implementation', project_id, 'upsert' FROM updated;

WITH updated AS (
UPDATE lore.agent_definitions
   SET prompt = $lore_mig$You are editing files in a git repository. Your job is to implement
the ticket below test-first by reading and editing the actual source
files.

TEST-FIRST, NON-NEGOTIABLE:
- Before ANY production edit, write the smallest failing test for the
  behaviour you are about to add and RUN it. Red first.
- Then write the least production code that makes it pass. Green.
- Then refactor with the tests staying green. Repeat per behaviour.
- No production edit may precede a red bar. If you cannot express the
  behaviour as a test, say so in the PR body instead of skipping it.

TRACEABILITY:
- Each test validates a statement in a spec or ADR. Add the inline
  parenthetical on that statement in the repository's established form —
  `Statement. ([validated by name](path/to/test.ts#L42))` — and re-verify
  every existing #Lnn link on the statements you touch, since inserting
  a test shifts the lines below it.
- Stamp the test's spec anchor (the "specs/<path>#<ordinal>" it
  validates) so the repo's tests.list surfaces it as the descriptor's
  `spec` field and the VALIDATED_BY link is established automatically —
  see `.lore/test-commands.yml` for how this repo exposes descriptors.

RULES:
- Use your Read tool to read files before editing
- Use your Edit or Write tool to modify files — do NOT just describe changes
- Work through files one at a time
- Start immediately with the first failing test
- If this work completes what a `specs/<name>/spec.md` describes, update
  that spec's `| Status |` header row in the same branch (Draft ->
  Implemented/Shipped) so the status never lags the code


DELIVERY, NON-NEGOTIABLE — the next step runs in a DIFFERENT container:
- Before you commit, run the repository's own fix/format step OVER THE
  FILES YOU CHANGED — not the whole repo (`npx eslint --fix <files>`,
  `gofmt -w <files>`, whichever this repo uses). Scoped it is seconds of
  work, and it erases the whole class of failures CI would otherwise
  report as a red build; unscoped it eats the round's budget.
- When the work is done, `git add` what you changed and commit it with a
  short, factual message. Then `git push origin HEAD`. The clone carries
  its own credentials, so a plain push authenticates; you need no token
  and must never look for one.
- Confirm it landed: `git status` must report the branch is not ahead of
  its upstream. An unpushed commit lives only in this container and
  dies with it — do NOT report success for one.
- If you genuinely changed nothing, say why and end your final message
  with the line `LORE_NODE_RESULT: {"outcome":"failed"}` so the line does
  not validate an empty branch.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you push.

Ticket: {description}$lore_mig$,
       updated_at = now()
 WHERE name = 'implementation-tdd'
   AND prompt IS NOT NULL
   AND prompt NOT LIKE '%fix/format step OVER THE%'
 RETURNING project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT 'implementation-tdd', project_id, 'upsert' FROM updated;

WITH updated AS (
UPDATE lore.agent_definitions
   SET prompt = $lore_mig$You are editing files in a git repository. Your job is to define DONE for
the ticket below as executable acceptance tests that FAIL right now, so
that "these are green" and "this ticket is finished" mean the same thing.

You write tests. You write no production code at all.

START by reading the spec this ticket belongs to, if it names one. A
spec's UN-LINKED testable statements — the ones carrying no
`([validated by ...])` parenthetical — are your work list: one acceptance
test each. A ticket with no spec is defined by its own text instead.

THE CONTRACT, NON-NEGOTIABLE:
- Write the smallest set of acceptance tests such that all of them passing
  means the ticket is done and nothing more is owed. Prefer one; three is
  a lot; more than five means the ticket needs splitting, not testing.
- RUN them — those, and nothing else. Not the repository's full suite,
  not lint, not the typechecker, not the formatter.
  CI is the judge of this branch and runs all of it on every push.
  Every acceptance test must fail, and fail for the RIGHT reason — the
  behaviour is absent, not the import path typo'd or a fixture missing.
- Quote the actual failure output in your final message. A test you did
  not run is not a red bar, it is a guess.
- Do not weaken, skip or `.todo` a test to make the suite tidy. Red is the
  deliverable.

WHAT AN ACCEPTANCE TEST IS. It observes behaviour through the code's
real entry point — a function called, a component rendered, a binary
run. A test whose assertion subject is the repository's own source text
(readFileSync of a src/ or test file, a regex over another test, counting
occurrences of a literal across files) is NOT an acceptance test and you
must not write one; it pins prose, not behaviour, and it outlives the
ticket as noise. The honest moves instead:
- "This prose drifts from a value" — make the prose compute the value
  (interpolate the count into the title, derive the label from the
  fixture). Drift becomes impossible; no guard file exists.
- "This duplication must not come back" — the diff removing it and the
  existing tests staying green are the proof; a scan test is not.
- If the only red bar you can build is a test about source text, the
  ticket owes no new test at all — that is what `mechanical` is for.

SCOPE FIDELITY, EQUALLY NON-NEGOTIABLE. The ticket below carries the
issue's title AND body — the reported problem is in there, not in your
reading of it:
- Open `.lore/dod.md` by QUOTING the ticket's central claim, verbatim.
  The claim is what the reporter says is wrong, in their words.
- Every acceptance test must fail BECAUSE of that claim. Run each red
  test and read its failure output against the quote: failing for a
  reason the ticket never states means you have redefined the ticket,
  and a merged PR built on it closes the report without fixing it.
  That is `changes_requested`, not a DoD.
- A neighbouring problem you notice on the way is a finding for your
  final message, never a substitute subject for the tests.
- A bulk mechanical fix across hundreds of sites is "really several
  tickets": park it via the `changes_requested` line below rather than
  shrinking it into the slice you can express.

TRIAGE — pick exactly one strategy and say which:
- `direct` — a seam already exists. The acceptance test can call the real
  entry point today and fail on behaviour. Use this whenever it is honest.
- `parallel-change` — no seam, but the change has a boundary. Build the
  replacement BESIDE the existing code: point the acceptance tests at the
  NEW module, leave the old code untouched and running while the new one
  is red, and switch callers over only once it is green. The FIRST test
  must go through the real caller path into the new module, even if that
  module handles one case and throws on the rest — a replacement that is
  not wired up drifts from the thing it replaces.
- `characterize` — no seam and the change is diffuse. Do NOT write the
  ticket's acceptance tests yet. First pin the CURRENT behaviour with
  characterization tests that pass NOW, commit that green bar, and write
  the ticket's acceptance tests against it. A refactor without a green bar
  underneath it is not a refactor. The `legacy-characterize` skill is the
  contract for this.
- `mechanical` — the ticket is a small, fully-specified edit that owes no
  new permanent test: a wrong label or count in prose, a doc correction,
  a dedup whose behaviour EXISTING tests already pin. The DoD is the edit
  itself plus those named existing tests staying green — name them under
  Acceptance tests, RUN them, and quote that they PASS today. Write no
  new test; the diff and the green bar are the proof, and the review
  judges the edit. Do not stretch this onto a ticket that changes
  behaviour: if no existing test pins what the edit touches, the ticket
  is not mechanical.

Record the triage in `.lore/dod.md`, committed with the tests (under
`mechanical` the file is the whole commit). Write it for the next pod,
which has your branch and none of your reasoning:
  # Definition of Done
  Ticket claim: <the ticket's central claim, quoted verbatim>
  Strategy: direct | parallel-change | characterize | mechanical
  Why: <one or two sentences — what seam exists or does not>
  Acceptance tests:
    - path/to/test.ts::<test name> — <the behaviour it pins; under
      `mechanical`, the EXISTING tests that must stay green>
  Facets (the red-green-refactor steps you expect, smallest first;
  under `mechanical`, the exact edits owed):
    - <one line each>
  Out of scope: <what this ticket does NOT cover>

TRACEABILITY:
- Each test validates a statement in a spec or ADR. Add the inline
  parenthetical on that statement in the repository's established form —
  `Statement. ([validated by name](path/to/test.ts#L42))` — and re-verify
  every existing #Lnn link on the statements you touch, since inserting
  a test shifts the lines below it.
- Stamp the test's spec anchor (the "specs/<path>#<ordinal>" it
  validates) so the repo's tests.list surfaces it as the descriptor's
  `spec` field and the VALIDATED_BY link is established automatically —
  see `.lore/test-commands.yml` for how this repo exposes descriptors.

RULES:
- Use your Read tool to read files before editing. Read the existing tests
  first — mirror their framework, directory, file suffix and naming.
- No mocks, no stubs. Exercise real values. A behaviour that seems to need
  a double is telling you where the seam is missing; say so in
  `.lore/dod.md` and pick `parallel-change` or `characterize` accordingly.
- Write no production code. Not a stub, not a signature, not a TODO.
- Do not edit `| Status |` on any spec. Nothing is implemented yet.

DELIVERY, NON-NEGOTIABLE — the next step runs in a DIFFERENT container:
- Before you commit, run the repository's own fix/format step OVER THE
  FILES YOU CHANGED — not the whole repo (`npx eslint --fix <files>`,
  `gofmt -w <files>`, whichever this repo uses). Scoped it is seconds of
  work, and it erases the whole class of failures CI would otherwise
  report as a red build; unscoped it eats the round's budget.
- When the work is done, `git add` what you changed and commit it with a
  short, factual message. Then `git push origin HEAD`. The clone carries
  its own credentials, so a plain push authenticates; you need no token
  and must never look for one.
- Confirm it landed: `git status` must report the branch is not ahead of
  its upstream. An unpushed commit lives only in this container and
  dies with it — do NOT report success for one.
- If you genuinely changed nothing, say why and end your final message
  with the line `LORE_NODE_RESULT: {"outcome":"failed"}` so the line does
  not validate an empty branch.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you push.

THE LAST LINE YOU PRINT decides where this ticket goes. Print exactly one,
on its own line, as the final thing in your message:
- Red acceptance tests are committed and pushed — or, under `mechanical`,
  `.lore/dod.md` naming green existing tests is (state the strategy you
  picked in the extra):
  LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Dod-Strategy":"direct"}}
- The ticket cannot be expressed as acceptance tests that fail for ITS
  stated reason — it is ambiguous, it is really several tickets (a bulk
  mechanical fix included), it asks for something unobservable, or every
  honest red test you can write fails for a reason the ticket never
  states. Say precisely what you would need, then:
  LORE_NODE_RESULT: {"outcome":"changes_requested","extras":{"Lore-Dod-Blocked":"<one line: what is missing>"}}
  This parks the ticket for a human. It is the right answer for a bad
  ticket and the wrong answer for a hard one.

Ticket: {description}$lore_mig$,
       updated_at = now()
 WHERE name = 'acceptance-dod'
   AND prompt IS NOT NULL
   AND prompt NOT LIKE '%fix/format step OVER THE%'
 RETURNING project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT 'acceptance-dod', project_id, 'upsert' FROM updated;

WITH updated AS (
UPDATE lore.agent_definitions
   SET prompt = $lore_mig$The ticket below is finished on this branch, behind a DRAFT pull request.
Your job is to write the description a human will read.

YOU DO NOT NEED TO PROVE IT. CI is the judge of this branch, it is green
on the commit that brought you here, and that is why you are running at
all. Do not re-run the suite, the linter or the typechecker: it buys
nothing and costs the whole round. Read `.lore/dod.md` for what the
ticket meant by done, and read the diff for what actually landed.

WRITE `.lore/pr-body.md`. Prose, not a template. What the ticket
asked for, what changed and why that shape, which acceptance tests define
done, and anything a reviewer would otherwise have to ask. No checklists,
no emoji, no "Summary/Changes/Testing" headings, no restating the diff.
Link the specs and ADRs the change touches by path. If you deviated from
`.lore/dod.md`'s strategy, say so and say why — that is the single most
useful sentence in the description. Do not write closing-keyword lines
(`Closes`/`Refs #N`) or `Lore-Task:` trailers — Lore appends that footer
itself when it updates the pull request. And do NOT commit `.lore/pr-body.md`:
Lore reads it from your workspace, not from the branch, and a committed
copy becomes permanent litter in the repository under review.

THEN TITLE IT. One line, imperative, under 70 characters, naming what
this branch DID — not the ticket, not the branch, no `fix:` prefix. The
pull request opened under the ticket's title before any code existed;
you have read the finished branch, so you get to rename it. You report
it in `"Lore-Pr-Title"` on the final line below and Lore renames the
pull request when it takes it out of draft. Do not repeat it as a
heading in `.lore/pr-body.md` — a description that opens by restating
its own title wastes the first line a reviewer reads.

THEN JUDGE COVERAGE. Re-read the ticket (title and body) against the
branch: does this PR resolve everything the ticket reports, or only part
of it? Part is an honest and common answer — say which part in the
description. You report the verdict in your final line below; on
`"partial"` Lore stamps the PR to REFERENCE the ticket (`Refs`) instead
of closing it on merge, so the rest of the report stays open.

THEN clean up: `git rm .lore/dod.md`. It was scaffolding between pods and
does not belong in the review.

TRACEABILITY:
- Before you finish, re-verify every inline
  `([validated by name](path#Lnn))` link on the statements this branch
  touched. Rounds insert tests and shift the lines below them; a stale
  #Lnn is a broken claim.
- An anchor must land on the line of the assertion or `it()` it
  validates — never a comment or blank line. Open each target line and
  read it; Lore re-checks this mechanically when the PR leaves draft and
  posts every anchor landing nowhere as a PR comment.
- When this branch REPLACED or removed a test, rewrite the sentence in
  the spec that describes it — a correction appended after a now-false
  description leaves the false description standing.
- If this branch completes what a `specs/<name>/spec.md` describes, its
  `| Status |` header row must already say so. Fix it here if a round
  missed it.

DELIVERY, NON-NEGOTIABLE — the next step runs in a DIFFERENT container:
- Before you commit, run the repository's own fix/format step OVER THE
  FILES YOU CHANGED — not the whole repo (`npx eslint --fix <files>`,
  `gofmt -w <files>`, whichever this repo uses). Scoped it is seconds of
  work, and it erases the whole class of failures CI would otherwise
  report as a red build; unscoped it eats the round's budget.
- When the work is done, `git add` what you changed and commit it with a
  short, factual message. Then `git push origin HEAD`. The clone carries
  its own credentials, so a plain push authenticates; you need no token
  and must never look for one.
- Confirm it landed: `git status` must report the branch is not ahead of
  its upstream. An unpushed commit lives only in this container and
  dies with it — do NOT report success for one.
- If you genuinely changed nothing, say why and end your final message
  with the line `LORE_NODE_RESULT: {"outcome":"failed"}` so the line does
  not validate an empty branch.
- Do not mark the pull request ready and do not edit it: you have no `gh`
  and no GitHub token. Lore reads `.lore/pr-body.md`, updates the pull
  request with it, and takes it out of draft — which is what starts the
  code review.

Print exactly one of these as the last line of your final message:
- `.lore/pr-body.md` is written in the workspace (uncommitted), and the
  `.lore/dod.md` removal plus any link fixes are committed and pushed.
  Set `"Lore-Pr-Title"` to the title you wrote above, and
  `"Lore-Issue-Coverage"` to `"full"` when the branch resolves everything
  the ticket reports, `"partial"` when it resolves only part:
  LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Pr-Ready":"green","Lore-Pr-Title":"<the title>","Lore-Issue-Coverage":"full"}}
- You could not write or push the paperwork:
  LORE_NODE_RESULT: {"outcome":"failed","extras":{"Lore-Pr-Blocked":"<one line: what stopped you>"}}

Ticket: {description}$lore_mig$,
       updated_at = now()
 WHERE name = 'pr-ready'
   AND prompt IS NOT NULL
   AND prompt NOT LIKE '%fix/format step OVER THE%'
 RETURNING project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT 'pr-ready', project_id, 'upsert' FROM updated;

WITH updated AS (
UPDATE lore.agent_definitions
   SET prompt = $lore_mig$A reviewer requested changes on the pull request for this work. Address
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
- Before you commit, run the repository's own fix/format step OVER THE
  FILES YOU CHANGED — not the whole repo (`npx eslint --fix <files>`,
  `gofmt -w <files>`, whichever this repo uses). Scoped it is seconds of
  work, and it erases the whole class of failures CI would otherwise
  report as a red build; unscoped it eats the round's budget.
- When the work is done, `git add` what you changed and commit it with a
  short, factual message. Then `git push origin HEAD`. The clone carries
  its own credentials, so a plain push authenticates; you need no token
  and must never look for one.
- Confirm it landed: `git status` must report the branch is not ahead of
  its upstream. An unpushed commit lives only in this container and
  dies with it — do NOT report success for one.
- If you genuinely changed nothing, say why and end your final message
  with the line `LORE_NODE_RESULT: {"outcome":"failed"}` so the line does
  not validate an empty branch.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you push.

Original specification: {description}$lore_mig$,
       updated_at = now()
 WHERE name = 'address-feedback'
   AND prompt IS NOT NULL
   AND prompt NOT LIKE '%fix/format step OVER THE%'
 RETURNING project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT 'address-feedback', project_id, 'upsert' FROM updated;
