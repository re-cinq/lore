Update the "Lore · evidence call" slide deck (currently 24 slides) to the version described below. Keep the existing visual style exactly: same fonts, colours, chips, cards, footer. Do not restyle anything. The result has 17 slides. Renumber every footer as "NN / 17".

## 1. New slide order

Use these existing slides, in this order. Slide titles are given so you can find them.

1. Title: "Lore"
2. "Who is in the call" (currently slide 13). Change its chip from "3 Target and team · people" to "Intro · who is in the call".
3. "Four blocks, mostly live" (agenda)
4. "We show the engine, not a product"
5. "Four layers, each with one job"
6. "From plan to merge, and where people decide"
7. "Live: real runs, from work item to merge"
8. NEW: "#2064: work item to merge, by the factory" (content in section 4)
9. NEW: "#2065: a person's change, corrected by the reviewer" (content in section 5)
10. NEW: "When something fails: three real cases" (content in section 6)
11. "Human review: enforced by structure, recorded on the run"
12. "Who may apply the automerge label"
13. "How workflow and gate files are protected"
14. "Claude, Gemini and MCP: where data goes"
15. "Azure Pipelines as the CI/CD standard"
16. "PostgreSQL RLS and single-tenant recovery"
17. "Repeatable beyond one team, and what comes next"

Delete all ten appendix slides (the ones whose chip starts with "Appendix").

## 2. Text changes on existing slides

Slide 3, agenda. Replace the subtitle
"Public or anonymised artefacts only. Commercial normalisation, capacity and tool costs go through the common RFP."
with
"We only show material that is public or anonymised. Pricing, staffing and tool costs are not part of this call; the RFP covers them."

Slide 17, close. Replace the grey line
"Commercial normalisation, capacity and tool costs are handled separately through the common RFP."
with
"Pricing, staffing and tool costs are not covered here; the RFP handles them."

## 3. Correct slide 7, "Live: real runs, from work item to merge"

The three cards are factually wrong today. #2065 is not a second agent run; a person wrote it and Lore's reviewer blocked it. Replace the three cards with:

- Pill "#2064". Heading "Work item to merge, by the factory". Text: "A ticket filed by a person, worked by the implementation line, merged by a person."
- Pill "#2065". Heading "A person's change, corrected by the reviewer". Text: "Blocked five minutes after it opened, fixed, re-checked on every push, merged."
- Pill "when it fails" (violet). Heading "Three real cases". Text: "A red build repaired, a ticket handed to a person, a ticket declined before any work."

Keep the "ON EVERY RUN" strip as it is.

## 4. New slide 8

Chip: "1 Evidence walkthrough · live · #2064"
Title: "#2064: work item to merge, by the factory" (the part after the comma in the accent blue)
Subtitle: "A person filed an outage ticket. The implementation line wrote the failing check, the fix and the pull request in 32 minutes. A person merged it. Every link below is the production record."

Five cards in one row. Each card has a small mono label, a heading, a short text, then a list of links under a thin divider. All links must be clickable.

Card 1. Label "1 · WORK ITEM". Heading "Ticket #1948".
Text: "Filed by a person on 9 Sep after a migration hook failed a deploy. Picked up by the backlog loop on 13 Sep at 21:38 UTC."
Links:
- "Issue #1948" → https://github.com/re-cinq/lore/issues/1948
- "Agent picked up this task" → https://github.com/re-cinq/lore/issues/1948#issuecomment-5656323872

Card 2. Label "2 · AGENT RUN". Heading "Seven visits, one run".
Mono line: "dod → open-pr → tdd-round → await-ci → ready-for-review → await-pr → retrospective"
Text: "21:38 to 22:10. Red test first, then the fix, each in its own pod."
Links:
- "Run page in Lore" (dbccc0a0) → https://lore.gcp.re-cinq.com/assembly-runs/dbccc0a0-b910-4e1c-bde8-0f90783d98ce
- "Task page" (27b3ec3b) → https://lore.gcp.re-cinq.com/tasks/27b3ec3b-3607-4334-97bd-13fca1c15f4e
- "Red test" → https://github.com/re-cinq/lore/commit/5ee00079f
- "the fix" → https://github.com/re-cinq/lore/commit/ee98cdd50
- "clean-up" → https://github.com/re-cinq/lore/commit/d9b1a0c23

Card 3. Label "3 · TESTS AND CI". Heading "26 checks green".
Text: "CI judged every push. The apply job runs the acceptance check the agent wrote: migrations as the application role against the full baseline."
Links:
- "All checks on the PR" → https://github.com/re-cinq/lore/pull/2064/checks
- "migrations · apply" → https://github.com/re-cinq/lore/actions/runs/34785659434/job/103800554771
- "integration" → https://github.com/re-cinq/lore/actions/runs/34785659401/job/103800554836

Card 4. Label "4 · REVIEW". Heading "By the person who merged".
Text: "On 13 Sep the reviewer did not yet judge pull requests the factory itself opened. Since 25 Sep its verdict lands on a lore/code-review check."
Links:
- "PR #2064, description and diff" → https://github.com/re-cinq/lore/pull/2064
- "#2196: verdict on factory PRs" → https://github.com/re-cinq/lore/pull/2196

Card 5. Label "5 · MERGE". Heading "A person, 22:56".
Text: "Squash-merged by a maintainer. The PR body carries Lore-Task, the commits carry the model that wrote them."
Links:
- "Merge commit 41fbfcf87" → https://github.com/re-cinq/lore/commit/41fbfcf87
- "Commits and trailers" → https://github.com/re-cinq/lore/pull/2064/commits

Strip under the cards. Label "IN LORE". Text: "The run page still holds the full transcript: 518 recorded agent turns across the seven visits, with every tool call and the cost."

## 5. New slide 9

Chip: "1 Evidence walkthrough · live · #2065"
Title: "#2065: a person's change, corrected by the reviewer" (after the comma in accent blue)
Subtitle: "The same evening, a maintainer opened a pull request by hand. Lore's reviewer blocked it five minutes later for a real defect, the author fixed it, and every later push was re-checked."

Five cards, same layout as slide 8.

Card 1. Label "1 · WORK ITEM". Heading "A human pull request".
Text: "Opened 13 Sep at 21:52 UTC: a loop ticket that failed for infrastructure reasons is deferred, a bounded number of times."
Links:
- "PR #2065" → https://github.com/re-cinq/lore/pull/2065
- "#1648" → https://github.com/re-cinq/lore/issues/1648
- "#2056" → https://github.com/re-cinq/lore/issues/2056

Card 2. Label "2 · REVIEW RUN". Heading "Blocked at +5 minutes".
Text: "The code-review line read the change in a clone and posted CHANGES_REQUESTED: one must-fix, one nit. The review names its model and run."
Links:
- "The review, 21:57" → https://github.com/re-cinq/lore/pull/2065#pullrequestreview-5192435245
- "Run page in Lore" (9a27aff3) → https://lore.gcp.re-cinq.com/assembly-runs/9a27aff3-1e10-4688-ad04-efdf8ca670c9

Card 3. Label "3 · THE FINDING". Heading "A real double-count".
Text: "The closing run was already marked failed, so the first failure counted as attempt two. Posted on the line, with a suggested fix."
Links:
- "The blocking finding" → https://github.com/re-cinq/lore/pull/2065#discussion_r4001030263
- "The author's answer" → https://github.com/re-cinq/lore/pull/2065#discussion_r4001040121
- "A nit, declined with a reason" → https://github.com/re-cinq/lore/pull/2065#discussion_r4001040196

Card 4. Label "4 · FIX AND RE-CHECKS". Heading "Approved on every push".
Text: "Fixed in one commit with a new test. Four re-check runs, each judging only what changed since the last verdict."
Links:
- "The fix, 016536120" → https://github.com/re-cinq/lore/commit/016536120
- "First re-check, 22:02" → https://github.com/re-cinq/lore/pull/2065#pullrequestreview-5192462501
- "Last re-check, 22:34" → https://github.com/re-cinq/lore/pull/2065#pullrequestreview-5192535681
- "A re-check run in Lore" → https://lore.gcp.re-cinq.com/assembly-runs/81324712-3370-451f-b3a9-76d397c89d61

Card 5. Label "5 · CI AND MERGE". Heading "Green, merged at 22:39".
Text: "All checks green, including lore/code-review. The author merged. The declined nit was taken two PRs later."
Links:
- "Checks on the PR" → https://github.com/re-cinq/lore/pull/2065/checks
- "#2067, where the nit landed" → https://github.com/re-cinq/lore/pull/2067

Strip. Label "WHAT IT SHOWS". Text: "Review is the same line for a person's pull request and for the factory's. People answer in the thread; the answer, and the reason, stay on the record."

## 6. New slide 10

Chip: "1 Evidence walkthrough · live · when something fails"
Title: "When something fails: three real cases" (after the colon in accent blue)
Subtitle: "Retries are bounded and named in the line definition. When a bound is spent the factory stops, says why on the ticket, and leaves the pull request for a person."

Three cards in one row. Each has a pill, a heading, a text, a mono line, then links.

Card 1. Pill "#2053" (blue). Heading "A red build, repaired, then merged".
Text: "CI went red after the first round, and stayed red after the second. The repair station took CI's failing checks, fixed only those, and the build went green."
Mono line: "tdd-round → CI red → tdd-round → CI red → repair-build → CI green → ready-for-review → merged"
Links:
- "Run page in Lore" (7217c809 · 11 visits · 730 turns) → https://lore.gcp.re-cinq.com/assembly-runs/7217c809-56b4-4443-bee5-1195c8eeb4a0
- "The red check" → https://github.com/re-cinq/lore/actions/runs/34733268139/job/103659909924
- "the repair commit" → https://github.com/re-cinq/lore/commit/b874fadc9
- "PR #2053" → https://github.com/re-cinq/lore/pull/2053
- "ticket #2025" → https://github.com/re-cinq/lore/issues/2025

Card 2. Pill "#2060" (violet). Heading "Out of repairs: handed to a person".
Text: "The build was still red after three fixes. The loop spent its budget, labeled the ticket lore:blocked, and wrote the reason on it. The pull request stayed open for a human; it was closed unmerged."
Mono line: "await-pr → fix-ci ×3 → parked"
Links:
- "The parking comment" → https://github.com/re-cinq/lore/issues/1899#issuecomment-5656185444
- "Run page in Lore" (d72bb72f) → https://lore.gcp.re-cinq.com/assembly-runs/d72bb72f-6eb5-4f6b-b67b-4ad0514103b9
- "PR #2060" → https://github.com/re-cinq/lore/pull/2060
- "ticket #1899" → https://github.com/re-cinq/lore/issues/1899

Card 3. Pill "#1846" (violet). Heading "A ticket it could not build: declined in six minutes".
Text: "The ticket asked for a lint rule, but that rule's code lives in another repository. The first station saw it could not write a failing test here. It wrote no code, opened no pull request, and parked the ticket with the reason and where to re-file it."
Mono line: "dod → parked"
Links:
- "The parking comment, with the reason" → https://github.com/re-cinq/lore/issues/1846#issuecomment-5655738403
- "Run page in Lore" (904278cf · 131 turns) → https://lore.gcp.re-cinq.com/assembly-runs/904278cf-30fd-43e1-9284-f84c76359bc5
- "Ticket #1846" → https://github.com/re-cinq/lore/issues/1846

Strip. Label "THE BOUNDS". Text: "12 rounds per ticket · 2 build repairs during the rounds · 3 CI fixes before review · 1 retry of a failed step. A spent bound is a finding for planning, not a silent loop."

## 7. Checks before you finish

- 17 slides, footers numbered 01 / 17 to 17 / 17.
- No slide whose chip starts with "Appendix" remains.
- Every link listed above is clickable and points to the exact URL given. Do not shorten, guess or invent URLs.
- Do not change any wording that this prompt does not mention.
