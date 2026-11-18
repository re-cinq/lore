/** What each step of the implementation loop does, in the words its station carries in the pipeline file: the loop's check run on the pull request shows them. */
const SYNC_DESC =
  "Checks whether the branch lacks commits of the default branch. A branch on current main goes straight on; a clean pull request GitHub calls behind is rebased by GitHub here; a conflict goes to the sync round.";
const REBASE_DESC =
  "An AI agent rebases the branch onto the default branch, resolves the conflicts and force-pushes with a lease, changing nothing else.";

export const LOOP_STEP_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "sync-start": SYNC_DESC,
  "sync-start-rebase": REBASE_DESC,
  "done-check":
    "Asks a small model whether a merged pull request that names the ticket already does it. Done ends the run with the ticket closed; anything else goes on to the definition of done.",
  brief:
    "Asks Lore's context builder once for the ticket's briefing and keeps it as a file every later agent of the run reads; a briefing that could not be built holds nothing.",
  dod: "An AI agent defines done for the ticket as acceptance tests that fail today, writing no production code. It ends the run if the ticket is unclear or already resolved.",
  "open-pr":
    "Opens a draft pull request for the ticket's branch, so every later round is judged by that pull request's CI.",
  "tdd-round":
    "An AI agent does exactly one red, green, refactor round toward the acceptance tests and pushes it. CI then judges the round.",
  "await-ci":
    "Waits until the pull request's CI judges the latest round. Green moves on to review, red asks for another round, and a build that stays red goes to repair.",
  "repair-build":
    "An AI agent fixes only the checks that stayed red after a round that pushed nothing new, so the loop does not re-derive the same failure.",
  "test-review":
    "An AI agent reads the tests the ticket's rounds wrote and checks them for the refusals the change owes: a caller with no right to ask, bad input, a failing upstream, a write. Missing ones go back to the round as failing tests or as written instructions.",
  "ready-for-review":
    "Writes the pull request's title and description from its diff, the ticket and the definition of done with one small model call, and deletes the definition of done from the branch.",
  "sync-final": SYNC_DESC,
  "sync-final-rebase": REBASE_DESC,
  "mark-ready":
    "Applies the written title and description and marks the draft pull request ready for review.",
  "await-pr":
    "Waits on the pull request until it is on current main, CI is green, Lore's review asks for no changes and no review thread is open. A branch behind or in conflict goes to the sync, red CI and Lore's requested changes to a fix, while a person's open threads end the run for people to settle.",
  "sync-pr": SYNC_DESC,
  "sync-pr-rebase": REBASE_DESC,
  "fix-ci":
    "An AI agent makes the red build green, or makes the changes Lore's review asked for, on the pull request after it was marked ready, changing only what CI or the review reported.",
};
