# Does the test review find missing refusal tests? A bench, 2026-11-19

The implementation loop gained a `test-review` station (`specs/external-floor` FR12.22): once CI is green, an agent reads the tests a ticket's rounds wrote and checks them for the refusals the change owes. This is the measurement behind shipping it. It ran on a laptop in `~/workspace/loop-bench` (`src/review/`, `experiments/test-review.yaml`), with the prompt this change ships, on the CLI the pods run.

## What was measured

Seven branches cut from tickets the loop merged on re-cinq/HALEngine. Each is green on the repository's own typecheck, lint and tests before a review sees it.

| Fixture | Cut from | What was done to it |
|---|---|---|
| `ws-list-seeded` | #144, a WebSocket frame that lists a user's conversations | 9 refusal tests deleted, 4 gaps: another user's id, the feature switched off, a malformed limit or cursor, a failing store. The code still refuses. |
| `tool-input-seeded` | #37, tool input validated against its schema | 3 refusal tests deleted: a missing required field, a wrong type, an unregistered tool. The code still refuses. |
| `ws-list-holes` | #144 | 2 real holes: the handler serves the list with the feature off, and the validator accepts any number as a page size. The tests that would notice are deleted, so the branch is green. |
| `tool-input-hole` | #37 | 1 real hole: a tool registered with a definition function skips validation. The one test that would notice is deleted. |
| `ws-list-control`, `tool-input-control` | #144, #37 | Nothing. The merged work as it is. |
| `usage-sum-no-entry-point` | #93, a change to how token usage is summed | Nothing. It changes no entry point. |

Two models reviewed each: `claude-opus-5-5` and `claude-sonnet-5-5`, three times on the four fixtures with gaps and once on the other three. That is 30 reviews, one at a time.

After each review the repository's tests ran on what the review pushed, so "it left a failing test" is measured and not taken from the review's own report.

## Results

| Fixture | Kind | Model | Runs | Seeded gaps | Found per run | Sent back to the round | Tests added (mean) | Left a failing test | Cost per run | Minutes |
|---|---|---|---|---|---|---|---|---|---|---|
| tool-input-control | control | claude-opus-5-5 | 1 | 0 | 0 | 0 of 1 | 4.0 | 0 of 1 | $0.50 | 1.7 |
| tool-input-control | control | claude-sonnet-5-5 | 1 | 0 | 0 | 0 of 1 | 4.0 | 0 of 1 | $0.18 | 0.9 |
| tool-input-hole | hole | claude-opus-5-5 | 3 | 1 | 1, 1, 1 | 3 of 3 | 2.7 | 3 of 3 | $0.43 | 1.5 |
| tool-input-hole | hole | claude-sonnet-5-5 | 3 | 1 | 1, 1, 1 | 3 of 3 | 3.7 | 3 of 3 | $0.20 | 0.9 |
| tool-input-seeded | seeded | claude-opus-5-5 | 3 | 3 | 3, 3, 3 | 0 of 3 | 5.0 | 0 of 3 | $0.46 | 2.0 |
| tool-input-seeded | seeded | claude-sonnet-5-5 | 3 | 3 | 3, 3, 3 | 0 of 3 | 5.3 | 0 of 3 | $0.20 | 0.9 |
| usage-sum-no-entry-point | no-entry-point | claude-opus-5-5 | 1 | 0 | 0 | 0 of 1 | 0.0 | 0 of 1 | $0.10 | 0.2 |
| usage-sum-no-entry-point | no-entry-point | claude-sonnet-5-5 | 1 | 0 | 0 | 0 of 1 | 0.0 | 0 of 1 | $0.04 | 0.1 |
| ws-list-control | control | claude-opus-5-5 | 1 | 0 | 0 | 0 of 1 | 2.0 | 0 of 1 | $0.68 | 2.1 |
| ws-list-control | control | claude-sonnet-5-5 | 1 | 0 | 0 | 0 of 1 | 2.0 | 0 of 1 | $0.34 | 1.3 |
| ws-list-holes | hole | claude-opus-5-5 | 3 | 2 | 2, 2, 2 | 3 of 3 | 4.3 | 3 of 3 | $0.70 | 2.4 |
| ws-list-holes | hole | claude-sonnet-5-5 | 3 | 2 | 2, 2, 2 | 3 of 3 | 2.7 | 3 of 3 | $0.26 | 1.1 |
| ws-list-seeded | seeded | claude-opus-5-5 | 3 | 4 | 4, 4, 4 | 0 of 3 | 6.0 | 0 of 3 | $0.82 | 3.0 |
| ws-list-seeded | seeded | claude-sonnet-5-5 | 3 | 4 | 4, 4, 3 | 0 of 3 | 5.7 | 0 of 3 | $0.24 | 0.9 |

The one `3` in the last row is the scorer's miss, not the review's. That run's list names "limit 0/201/1.5/'10'/null; before string/bad updatedAt/missing half" in words the scorer's pattern did not match. Read by hand, both models found every seeded gap in every run: 30 of 30 each.

What the table says:

- **A test that was only missing gets added, and no round is spent on it.** On the two seeded fixtures every review wrote the missing tests, saw them pass, pushed them and answered `success`. No run was sent back.
- **A real hole comes back as a failing test.** On the two hole fixtures every review, 12 of 12, left the suite red with a test that fails because the code does not refuse, named the line at fault, and answered `changes_requested`.
- **No entry point costs almost nothing.** The #93 change was answered "no entry point" in 6 to 12 seconds for 4 to 10 cents.
- **On untouched work the review still adds tests.** Each control got 2 to 4 more refusal tests (an `enum` violation, input that is not an object, a store that answers garbage). All of them passed, so nothing was sent back. They are fair refusals the merged work never tested; they are also why the prompt caps a review at five items.
- **The cheaper model did as well here.** Sonnet 5.5 found the same gaps and holes as Opus 5.5 at $0.22 a review against $0.57, in 0.9 minutes against 2.0. The whole bench cost $8.52 on Opus and $3.26 on Sonnet at list prices.

## What it changed in the prompt

The first review, before the batch, found three of three missing tests, wrote them, saw them pass and still answered `changes_requested`. That would have sent a finished ticket back for a round with nothing to do. The prompt now tells the two cases apart: a test that passes is kept and nothing is owed, and only a test that fails because the code does not refuse, or one that could only be described, goes back to the round.

## What this does not show

- **The fixtures were easier than real work in one way.** The specs on these branches still describe the refusals whose tests were deleted, so a reviewer reads "a limit outside 1 to 200 is refused" and finds no test for it. A repository with no spec gives less to go on.
- **This repository already has two nets.** HALEngine's lint requires a link from each spec statement to a test, and its coverage threshold fell below its gate on the larger seeded fixture. Both would have flagged that branch without any review. The holes were the opposite: green on everything the repository runs.
- **Three tickets, one repository, TypeScript.** Small and medium changes. Nothing here says how a review does on a change across many modules, or in another language.
- **Nothing ran on a floor.** The station's place in the line, the file it hands the round, and the trip back to `tdd-round` are covered by the pipeline tests, not by a run.
- **The scorer is a set of patterns.** It decides "found" by matching words in what the review wrote. It missed one that was there. The lists of all 12 hole runs and of 4 of the other 18 were read by hand, and every hole run is also confirmed by the red suite instead of by words.

## How a benchmark leaks

The first batch was thrown away after two runs. Each seeded fixture was two commits, the ticket and then the cut, and Opus found the second commit and reverted it: every deleted test back in a minute, nothing learned. The fixtures became single commits. Then a second leak: a run's local `origin` was cloned from a mirror whose release tags and pull-request refs still held the merged tests, readable with `git show v0.6.0:…`. A run now keeps only `main` and the ticket's branch, with every other ref deleted and the objects pruned.

The two leaked results are kept in `results/test-review/2026-11-19-leaked-history/` in loop-bench.

## The model

The station ships on `claude-opus-5-5`, chosen for a more capable second reader than the round's own model. On these fixtures that bought nothing: Sonnet 5.5 matched it for 40% of the cost. The fixtures may be too easy to tell the two apart. Switching the station to `claude-sonnet-5-5` is a one-line change to `loop-test-review.md` and is left as a decision.
