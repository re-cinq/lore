# Definition of Done

> The Floor owns that artifact — it is never merged into the line's args: each question is written into the plan as an agent question with an id keyed on the review comment it answers for (on its section and text only when it names none), so a rework that rewords it replaces rather than repeats it — the second rework on Otto #261 asked the same question twice before that; each addressed comment is answered on its thread and the thread resolved — resolved even on a redelivery whose reply already landed, since the first delivery's resolve can have failed; a whole review body, which sits in no thread, is answered as a comment on the PR naming the review, and nothing is resolved for it; each to_plan comment is answered "sent to the plan" and left open; a reply already on the PR is not posted twice; every question lands on a slot the plan HAS — planning-document applies an agent question by section slot and silently keeps the plan as it was when no section has that slot, which is how the first rework on Otto #261 lost four of six questions — so a slot that names no section is re-homed to the section whose title (or title-shaped slug) it names, else to the plan's Open questions section (its last section when it has none), counted as rehomed and logged; and a to_plan reply whose comment no question answers for gets one made from the comment itself, on Open questions, keyed on the same comment, so "sent to the plan" is never a lie; and a run that sent any question is flagged so that when its line parks on the PR wait again the plan is reopened for its people — the line goes back to the author, the page reads as reopened, and approving again updates the same PR.

**Strategy: `parallel-change`** — no seam, but the change has a boundary. Build the replacement BESIDE the existing code: point the acceptance test at the NEW event handler, leave the old code untouched and running while the new one is red, and switch callers over only once it is green. The test fails because the handler for `spec.review.result` does not exist yet.

## Done when these pass

- [ ] **spec.review.result event** — writes plan questions for to_plan comments, resolves threads for addressed, and re-homes questions missing a slot
  `apps/stations/src/events/spec-review-result.acceptance.test.ts`

## Facets

- [ ] write a handler for `spec.review.result` and register it in `buildStationHandlers()`
- [ ] write `to_plan` plan questions into plan with id keyed on review comment
- [ ] replace existing questions with same comment id instead of duplicating
- [ ] re-home questions to Open questions if target slot doesn't exist
- [ ] create a plan question from a `to_plan` comment itself if no question answers for it
- [ ] answer `addressed` comments on their threads and resolve the threads
- [ ] resolve thread even if reply already landed
- [ ] answer whole review bodies as PR comments without resolving
- [ ] answer `to_plan` comments with "sent to the plan" and leave open
- [ ] flag the run so the plan is reopened when line parks on PR wait again

## Out of scope

- modifying the `spec-rework` agent prompt