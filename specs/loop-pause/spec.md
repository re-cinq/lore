# Feature Specification: Loop Pause

| Field     | Value                                                                    |
|-----------|--------------------------------------------------------------------------|
| Feature   | Loop Pause                                                               |
| Status    | In Progress                                                              |
| Created   | 2026-10-30                                                               |
| Owner     | Platform Engineering                                                     |
| Builds on | [specs/implementation-loop](../implementation-loop/spec.md)              |
| Story     | [#3998](https://github.com/re-cinq/lore/issues/3998)                     |

When a station runs out of model credit ("Credit balance is too low", or Gemini's spent quota), every loop treated it as a failure of the work in hand: the implementation loop labelled the ticket `lore:blocked`, triage labelled the issue `triage: failed`, and the loop went on picking the next item only to fail it the same way. Nothing about the item was wrong. This feature pauses the loop instead and leaves the item queued, so topping up the account and pressing Resume is all a person does.

## FR1 — A pause holds a loop without touching its switch

- A loop's pause is stored in the repository's settings as `loop_pauses.<loop key>`, holding why, the run that caused it, when, and an optional end (`until`). ([validated by returns the implementation pause stored under loop_pauses](../../libs/shared/src/domain/loops/loop-pause.test.ts#L15), [validated by reads a settings column handed over as a JSON string](../../libs/shared/src/domain/loops/loop-pause.test.ts#L34))
- A missing or malformed pause reads as no pause. ([validated by returns null when the loop has no pause](../../libs/shared/src/domain/loops/loop-pause.test.ts#L23), [validated by returns null for a pause without a reason](../../libs/shared/src/domain/loops/loop-pause.test.ts#L28))
- A pause with no end holds until a person resumes the loop; a pause with an end resumes by itself once it passes, with no write needed. ([validated by returns false when there is no pause](../../libs/shared/src/domain/loops/loop-pause.test.ts#L47), [validated by returns true for a pause with no end](../../libs/shared/src/domain/loops/loop-pause.test.ts#L51), [validated by returns true until 13:00 and false after it](../../libs/shared/src/domain/loops/loop-pause.test.ts#L55), [validated by reads true again once a pause that ended in 2020 has passed](../../libs/shared/src/domain/loops/loop-pause.test.ts#L88))
- While a pause holds, the loop starts no work: every reader a tick or event handler asks whether its loop is on answers no, and the loop's own switch keeps the value its owner set. ([validated by reads implementationLoopEnabled false while its switch stays on](../../libs/shared/src/domain/loops/loop-pause.test.ts#L72), [validated by reads autoReviewEnabled false](../../libs/shared/src/domain/loops/loop-pause.test.ts#L77), [validated by starts nothing for a repo whose digest loop is paused](../../apps/stations/src/work/digest-tick/digest-tick.test.ts#L168))
- A pause holds only its own loop. ([validated by reads triage false and spec upkeep true when only triage is paused](../../libs/shared/src/domain/loops/loop-pause.test.ts#L81))

## FR2 — Pausing and resuming are merge writes

- Pausing a loop merges its pause into the settings: the repository's other settings and the other loops' pauses survive, and a settings column that holds nothing is treated as empty. ([validated by runs the Postgres contract, or explains why it is skipped](../../libs/shared/src/outbound/project/settings/settings-loop-pause.contract.test.ts#L46), [validated by stores the implementation pause and keeps the switch and other settings](../../libs/shared/src/outbound/project/settings/settings-loop-pause.contract.test.ts#L73), [validated by keeps the review pause when the triage loop pauses too](../../libs/shared/src/outbound/project/settings/settings-loop-pause.contract.test.ts#L87), [validated by pauses a repo whose settings column is null](../../libs/shared/src/outbound/project/settings/settings-loop-pause.contract.test.ts#L116))
- Resuming forgets only that loop's pause. ([validated by forgets only the resumed loop's pause](../../libs/shared/src/outbound/project/settings/settings-loop-pause.contract.test.ts#L101))
- `DELETE /api/repos/{owner}/{repo}/loops/{key}/pause` (admin) resumes a loop and leaves its switch as it is; a repository with no row answers 404. ([validated by DELETE review pause forgets it and echoes the key](../../apps/lore-api/src/transport/routes/loops/loops.test.ts#L152), [validated by DELETE a pause on a repo with no row answers 404](../../apps/lore-api/src/transport/routes/loops/loops.test.ts#L175))
- Switching a loop on also resumes it; switching it off leaves its pause alone. ([validated by PUT implementation on forgets the implementation pause](../../apps/lore-api/src/transport/routes/loops/loops.test.ts#L131), [validated by PUT merge on writes auto_merge.enabled with no approval asked](../../apps/lore-api/src/transport/routes/loops/loops.test.ts#L293), [validated by PUT review off leaves the review pause alone](../../apps/lore-api/src/transport/routes/loops/loops.test.ts#L142))
- The Loops tab's switch shows the switch, not the pause: a paused loop that is switched on reads as on. ([validated by GET shows a paused implementation loop as switched on](../../apps/lore-api/src/transport/routes/loops/loops.test.ts#L110))

## FR3 — Any station in any loop that runs out of credit pauses that loop

- A failed station visit whose error says the model's credit or quota is spent is a credit failure, whether the visit was an agent pod or a station that called a model itself; a successful visit that merely quoted the message is not. ([validated by returns the agent visit's credit error](../../libs/shared/src/domain/loops/credit-failure.test.ts#L8), [validated by returns a service station's Gemini quota error](../../libs/shared/src/domain/loops/credit-failure.test.ts#L17), [validated by returns null when the failure is not about credit](../../libs/shared/src/domain/loops/credit-failure.test.ts#L26), [validated by returns null for a successful visit that quoted the credit message](../../libs/shared/src/domain/loops/credit-failure.test.ts#L35))
- Every floor line names the loop it belongs to, or is listed as belonging to none; a new pipeline file cannot skip the decision. ([validated by returns implementation for implementation-loop](../../libs/shared/src/domain/loops/loop-of-line.test.ts#L11), [validated by returns review for every code-review line](../../libs/shared/src/domain/loops/loop-of-line.test.ts#L15), [validated by returns merge, triage, upkeep, digest and tickets for their lines](../../libs/shared/src/domain/loops/loop-of-line.test.ts#L23), [validated by returns null for onboard](../../libs/shared/src/domain/loops/loop-of-line.test.ts#L35), [validated by names every floor pipeline either a loop's line or not a loop](../../libs/shared/src/domain/loops/loop-of-line.test.ts#L39))
- When a run of a loop's line settles with a credit failure, the run-settled station pauses that loop in that repository, with no end, before the loop's next tick.
- Other loops and other repositories keep running.

## FR4 — The item a credit failure interrupted stays queued

- The implementation loop neither labels the ticket `lore:blocked` nor counts the failure as an infrastructure deferral; it records why on the task and comments once on the issue that the loop paused and the ticket stays queued.
- No loop writes a failed, blocked or done state for the item on a credit failure: issue triage adds no `triage: failed`, and a loop that skips an item it already ran does not count the credit-failed run.
- The code-review loop keeps approving the pull request without review when credit runs out, so the pull request is not held on an operator problem.

## FR5 — The Loops tab shows a paused loop

- A paused loop's pill shows why, since when, and until when if it has an end, links the run that paused it, and offers Resume.

## Out of Scope

- Pausing on a token-usage burst. The pause's `until` exists so such a rule only has to write a pause.
