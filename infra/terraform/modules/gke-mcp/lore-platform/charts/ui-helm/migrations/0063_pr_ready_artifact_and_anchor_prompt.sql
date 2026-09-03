-- The pr-ready artifact + paperwork round (#1746 + #1747). The recipe no
-- longer commits `.lore/pr-body.md` — the declared artifact watch reads it
-- from the pod's workspace, and every delivered loop PR was permanently
-- adding the file to the target repo — and its TRACEABILITY contract now
-- demands anchors land on the assertion they validate (never a comment or
-- blank line; the Floor re-checks mechanically at the ready flip) and that a
-- replaced test's spec sentence be rewritten, not appended to. Same rollout
-- shape as 0057/0061/0062: the seeded org rows outrank the yaml; only rows
-- still carrying the prior text are rewritten, and only rewritten rows emit
-- a catalog event.
WITH updated AS (
UPDATE lore.agent_definitions
   SET prompt = $lore_mig$The ticket below is finished on this branch, behind a DRAFT pull request.
Your job is to prove that and write the description a human will read.

FIRST, PROVE IT. Read `.lore/dod.md` and run every acceptance test it
names — exactly those, not the repository's full suite: CI runs the full
suite on every push and the review gates on it, so repeating it here
buys nothing and costs the whole round (a monorepo suite on a run pod's
single CPU does not fit any deadline). If ANY acceptance test is red, do
not write a description — report which, and end with the `failed` line
below. A draft PR that is honestly still red is a better outcome than a
review request that wastes a person's afternoon.

THEN write `.lore/pr-body.md`. Prose, not a template. What the ticket
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
- Before you commit, run the repository's OWN format/fix step if it has one
  (`npm run format`, `make fmt`, `cargo fmt`, whichever this repo uses).
  Most lint failures a reviewer or CI would report are auto-fixable
  whitespace and brace style; leaving them turns a finished piece of work
  into a red build over nothing.
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
- Every acceptance test is green, `.lore/pr-body.md` is written in the
  workspace (uncommitted), and the `.lore/dod.md` removal plus any link
  fixes are committed and pushed. Set
  `"Lore-Issue-Coverage"` to `"full"` when the branch resolves everything
  the ticket reports, `"partial"` when it resolves only part:
  LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Pr-Ready":"green","Lore-Issue-Coverage":"full"}}
- Something is still red:
  LORE_NODE_RESULT: {"outcome":"failed","extras":{"Lore-Pr-Blocked":"<one line: what failed>"}}

Ticket: {description}
$lore_mig$,
       updated_at = now()
 WHERE name = 'pr-ready'
   AND prompt LIKE '%Lore-Issue-Coverage%'
   AND prompt NOT LIKE '%do NOT commit `.lore/pr-body.md`%'
RETURNING project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT 'pr-ready', project_id, 'upsert'
  FROM updated;
