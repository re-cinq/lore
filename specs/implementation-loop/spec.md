# Feature Specification: Implementation Loop

| Field     | Value                                                                    |
|-----------|--------------------------------------------------------------------------|
| Feature   | Implementation Loop                                                      |
| Status    | In Progress                                                              |
| Created   | 2026-08-24                                                               |
| Owner     | Platform Engineering                                                     |
| Builds on | [specs/github-issue-dispatch](../github-issue-dispatch/spec.md)          |

Lore reacts but never initiates. A human labels an issue, one task runs, one PR opens, and the factory goes quiet until the next human gesture. This feature gives a repo a backlog and a loop that works it: pick the highest-priority open issue, implement it test-first, open a PR, wait until that PR is green with no outstanding review comments, then pick the next one. It never merges — a human still does that, whenever they like.

## Problem Statement

Today's path from issue to PR is a single-shot reaction. `issuesLabeled` in `apps/floor/src/jobs/github.ts` fires only on `action === "labeled"`, compares the added label against the repo's `dispatch_label`, and mints one `pipeline.tasks` row. The Floor worker claims it, `AssemblyLineStationBackend.launch` starts the `implementation` line, a PR opens, and the chain terminates there.

Three things are missing.

**There is no backlog.** The only ordering anywhere is the binary `priority` column on `pipeline.tasks` (`normal` | `immediate`) read by `claimNextPending` in `libs/shared/src/project/tasks/task-queue-pg.ts`. The webhook dispatch path never sets it, so every issue-dispatched task lands at `normal` and is claimed strictly in `created_at` order. Nothing in the repo expresses "this issue matters more than that one" — the label taxonomy in `docs/using-lore/developer.md` is purely routing (`lore`, `lore:implementation`, `lore:review`, `lore:runbook`) with no severity dimension.

**There is no re-arm.** When a run finishes, nothing looks for the next piece of work. Every ticket needs its own human label gesture to enter the system.

**There is no visibility into what is queued.** The Features tab at `apps/web-ui/src/app/repos/[owner]/[repo]/features/` shows planning work; nothing shows implementation work in flight or waiting.

A fourth gap sits underneath the "wait until the PR has no outstanding comments" requirement: the review round-trip in `apps/floor/src/jobs/review/code-review.ts` posts replies through `postReplyFromNode` but never resolves the review thread. GitHub exposes thread resolution only over GraphQL, and this repository contains no GraphQL client — `grep -rni graphql` over every `src/` returns zero hits. Without resolution there is no durable signal that a comment has been dealt with, so "no outstanding comments" is not currently computable.

## FR1 — Priority taxonomy and eligibility

- The repo carries four new labels: `priority:high`, `priority:medium`, `priority:low`, and `lore:blocked`.
- An issue is eligible for the queue when it is open, carries exactly one `priority:*` label, does not carry `lore:blocked`, and has no open Lore-authored PR already referencing it.
- Queue order is `priority:high` before `priority:medium` before `priority:low`; ties are broken by oldest `created_at` first.
- An issue carrying no `priority:*` label is never picked. Applying a priority label is the opt-in; no second dispatch label is required.
- An issue carrying more than one `priority:*` label is treated as ineligible rather than silently resolved to the highest, so the ambiguity surfaces to a human instead of being guessed at.
- The selection logic is a pure function over a list of issue records, with no I/O, so ordering is testable without GitHub.

## FR2 — The loop is a driver, not a cyclic assembly line

- Each assembly run handles exactly one ticket. The loop lives in a Floor handler that starts the next run when the previous one finishes, following the shape already used by the detection fan-out in `apps/floor/src/jobs/detect/fan-out.ts`.
- The loop is not expressed as a back-edge in the line's YAML. `libs/assembly-lines/src/loader.ts` rejects an unbounded cycle unless a human station gates it, so a cyclic definition would require an `iteration_max` — capping a repo's backlog at a literal integer — and would require a new node type, which costs changes in the loader enum, `PRODUCIBLE_OUTCOMES`, the station runner, the station map, `scripts/task-types.yaml`, the web-ui type mirror, and two drift checks.
- Only one run per repo is in flight at a time. Serialisation reuses the existing unique index on `pipeline.assembly_runs (repo, subject_key)` for open rows: the loop starts every run with `subjectKey: "impl-loop:<repo>"`, and `PgAssemblyRuns.start` returns the id of the in-flight run instead of creating a second one.
- The driver runs on a cron tick as a safety net and is also invoked directly when a loop run reaches a terminal state, so there is no scheduling gap between one ticket finishing and the next starting.
- On each invocation for a repo the driver skips when the repo's toggle is off, skips when an open run already holds the repo's subject key, and otherwise selects the next eligible issue and starts a run carrying the issue number and URL in its args.
- When no issue is eligible the driver does nothing and leaves no run behind. An empty backlog is a normal state, not a failure.

## FR3 — The assembly line definition

- A new definition `implementation-loop` is added to `libs/assembly-lines/src/assembly-lines/`. ([validated by happy path walk](../../libs/assembly-lines/src/implementation-loop-line.test.ts#L31))
- Its nodes are `implement` (agent), `validate`, `push`, `await-pr` (human station of type `pr_review`), `retrospective`, and `done`. ([validated by pr_review park](../../libs/assembly-lines/src/implementation-loop-line.test.ts#L41))
- The happy path is `implement` to `validate` to `push` to `await-pr` to `retrospective` to `done`. ([validated by finishes at done](../../libs/assembly-lines/src/implementation-loop-line.test.ts#L88))
- `implement` retries itself once on `failed` via a back-edge with `iteration_max: 1`. A second failure fails the run with outcome `iteration_max` — `getNextTransition` refuses an exhausted back-edge rather than consulting a further `failed` edge, exactly as the existing `implementation` line behaves — and the driver then marks the ticket blocked (FR8); the retrospective is skipped on that path. ([validated by second failure fails the run](../../libs/assembly-lines/src/implementation-loop-line.test.ts#L57))
- `await-pr` resuming with `success` means the PR is ready and the ticket is complete; resuming with `changes_requested` means the ticket is blocked. Both route to `retrospective` so the run always closes through the same exit. ([validated by one exit for both](../../libs/assembly-lines/src/implementation-loop-line.test.ts#L75))
- `await-pr` declares `route: "{args.pr_url}"`, satisfying the loader's requirement that a human station carry a route built only from `{args.*}` placeholders. ([validated by pr_review park](../../libs/assembly-lines/src/implementation-loop-line.test.ts#L41))
- The definition introduces no new node type. `implement` is an ordinary `agent` node; `validate`, `push` and `retrospective` reuse the existing station recipes unchanged. ([validated by implementation-tdd recipe](../../libs/assembly-lines/src/implementation-loop-line.test.ts#L50))
- Every outcome each node can produce has an outgoing edge, because `selectEdge` in `libs/assembly-lines/src/transition.ts` does not fall through when no edge matches.
- The PR-open path stamps `{ pr_url, pr_number }` onto the task's open assembly runs through `mergeArgs` (SQL-side merge, so concurrent node artifacts are not clobbered), resolved via the task's `listForTask` — the PR-keyed lookup (`findOpenByPr`) matches on `args.pr_number`, which does not exist until this very stamp. ([validated by stamps open runs](../../apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L180), [validated by no open run is a no-op](../../apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L200))

## FR4 — Waiting on the pull request

- A node of type `pr_review` parks: `apps/floor/src/jobs/assembly-run/advance.ts` mints the station run row but dispatches no Agent CR, and the reaper classifies it as `wait` so it is never timed out. The run sits at `await-pr` indefinitely and the graph shows whose move it is.
- A polling station job evaluates every open `implementation-loop` run parked at `await-pr` and reports the verdict through the existing `parkedHumanNode` and `reportToParkedNode` helpers, which insert an `assembly_run.resume` event — the same mechanism `resumeDecomposition` already uses to unpark a feature-planning line on a merged spec PR.
- A PR is ready when its CI conclusion is `success` and it has zero review threads that are unresolved and not outdated. Both conditions must hold.
- A PR whose CI conclusion is `pending` produces no verdict; the job re-evaluates on its next tick.
- A PR that is red, or that still carries unresolved threads after the address round-trip has had its chance, resumes the node with `changes_requested`, marking the ticket blocked.
- The green check reads the GitHub Checks API only. Legacy commit statuses are invisible to it, so a branch protection rule expressed as a status rather than a check will not be seen. This limitation is accepted, not worked around.

## FR5 — Review comments reuse the existing choreography

- The line contains no address node. Review comments are handled entirely by the existing PR-review family: `code-review` posts the bot review, `comment-triage` classifies each human comment, and `code-review-reply` commits the fix on the branch and posts the reply.
- The loop's only interaction with that choreography is observational — it waits for the resulting state rather than driving it.
- Review threads are resolved once their reply has been posted, so that "no outstanding comments" reflects GitHub's own resolved flag rather than a private Lore-side tally.
- Resolving a thread is best-effort. A failure to resolve is audited and does not fail the node that posted the reply.

## FR6 — Test-first implementation prompt

- A new agent recipe drives the `implement` node. The existing `implementation` recipe is left untouched, because the existing `implementation` line still uses it.
- The prompt requires a failing test before any implementation: red, then green, then refactor. No production edit precedes a red bar.
- The prompt requires that each test carry an inline traceability link on the spec or ADR statement it validates, in the repository's established parenthetical form, and that the test descriptor stamp the corresponding spec anchor so the test interface surfaces it.
- The prompt requires that a change completing a `specs/<name>/spec.md` update that spec's `| Status |` header row in the same branch.
- A `prompt_ref` naming no recipe is a build failure via the existing drift guard, and `buildNodePrompt` throws rather than silently substituting the `general` prompt. ([validated by prompt_ref drift guard](../../libs/assembly-lines/src/prompt-refs.test.ts#L53))

## FR7 — Per-repo enable toggle

- `lore.repos.settings` gains an `implementation_loop` block with an `enabled` boolean.
- The setting is read through a pure predicate that defaults to disabled by omission, mirroring `autoReviewEnabled` in `apps/floor/src/jobs/review/should-auto-review.ts`. A repo that has never heard of this feature never runs it.
- The toggle lives at the top level of the settings object, not inside `dark_factory`. It confers no merge authority, so it must not be dragged behind the two-key CODEOWNERS ceremony that guards the dark-factory privileged fields.
- Disabling the toggle stops new tickets from being picked. It does not cancel a run already in flight; that run finishes normally and simply is not followed by another.

## FR8 — Blocked tickets never stall the loop

- When a run ends blocked or errored, the driver applies `lore:blocked` to the issue and comments on it explaining why, naming the failing condition and linking the run.
- The `lore:blocked` label makes the issue ineligible under FR1, so it will not be picked again until a human removes the label.
- The PR, if one was opened, is left open for a human. Nothing is closed or reverted.
- The driver re-arms immediately after marking a ticket blocked. One bad ticket never freezes a repo's backlog.

## FR9 — The repo tab

- A new tab appears in the repo tab row alongside Features, routed under `/repos/{owner}/{repo}/`.
- The page follows the container and view split used throughout `apps/web-ui/src/app/repos/[owner]/[repo]/features/`: a server component performs the read and a client view renders pure props. The view performs no I/O.
- The top section carries the enable/disable control and reflects the current toggle state.
- Below it the page shows three groups in order: the ticket currently being worked, with links to its issue and its PR; the ordered queue of tickets that will be picked next; and recently addressed tickets, each with links to its issue and its PR.
- When the loop is disabled the page still renders the queue, so a developer can see what would be worked before switching it on.
- When no ticket is in flight the current section states that plainly rather than rendering an empty container.

## FR10 — API contract

- A read endpoint returns the toggle state, the current ticket, the upcoming queue, and the recently addressed tickets for one repo, under the read bearer scope.
- Each ticket entry carries the issue number, issue URL, title, priority, PR URL when one exists, and its state.
- A write endpoint sets the toggle under the admin bearer scope.
- Both endpoints declare zod request and response contracts so the generated OpenAPI document and the web-ui types stay in step; the committed `openapi.json` and `schema.d.ts` are regenerated with the change.
- The web-ui client aliases the generated component schema rather than re-declaring the response shape by hand.

## Alternatives Rejected

**A cyclic assembly line with a back-edge from `done` to a pick node.** The loader refuses an unbounded cycle unless a human station gates it, so this needs an `iteration_max`, which caps a repo's backlog at a literal integer written into a YAML file. It also needs a new node type for the pick step, touching the loader enum, the outcome table, the station runner and its map, the task-types recipe file, the web-ui type mirror and two drift checks. A driver achieves the same behaviour with no new node types and no cap.

**A bespoke address node inside this line.** The `code-review-reply` line already implements exactly this: it takes a triaged comment, commits the fix on the PR branch, and posts the reply. Duplicating it would create a second implementation of the same behaviour that would drift from the first.

**Putting the toggle inside `dark_factory`.** That block's fields are privileged because they confer merge authority, and touching any of them requires an approval PR labelled by a CODEOWNER. This loop never merges, so binding it to that ceremony would impose a cost with no matching risk.

**Running several tickets per repo concurrently.** "Pick the top most important ticket" describes a serial queue. Concurrency would require per-issue claim mechanics so two runs never grab the same ticket, and would make the "current ticket" section of the UI a list. It is deferred until a repo demonstrably starves.

**Deriving readiness from a Lore-side tally of addressed comments.** Lore would then disagree with GitHub about whether a comment had been dealt with, and a human resolving a thread by hand would be invisible. Reading GitHub's own resolved flag keeps one source of truth, at the cost of adding a GraphQL client.

## Out of Scope

- Merging. A human merges every PR this loop produces; the loop has no merge authority and requests none.
- Cross-repo scheduling or a global priority queue spanning repos. Each repo's loop is independent.
- Concurrency above one ticket per repo.
- Commit-status support in the green check; the Checks API is the only source.
- Automatic priority assignment. A human decides what `priority:high` means.
- Cancelling an in-flight run when the toggle is switched off.
