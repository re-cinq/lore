# Feature Specification: The external floor runs the code-review lines

| Field   | Value                            |
|---------|----------------------------------|
| Feature | External floor, code-review lines |
| Branch  | `feat/external-floor-code-review` |
| Status  | Draft                            |
| Created | 2026-09-30                       |
| Owner   | Platform Engineering             |

The Floor was rewritten as a standalone engine ([re-cinq/floor](https://github.com/re-cinq/floor)) that stores assembly-line definitions, walks runs, queues work and serves a live socket, and that holds no GitHub client and never calls out. This spec is the first slice of replacing `apps/floor` with it ([ADR-049](../../adrs/ADR-049-external-floor.md)): the three code-review lines run on the external floor, reached only through `@re-cinq/floor-client`, while every other line stays on `apps/floor` until its own slice.

## Background

The external floor assigns three jobs to whoever owns GitHub: start its lines, run a service station for every GitHub action a line takes, and answer its git-credential request. Lore owns GitHub, so those three jobs are this spec. Both floors run side by side: a run is either in `pipeline.assembly_runs` (Lore's Floor) or in the external floor's own database, and the run page reads both.

Two behaviours of Lore's Floor are not carried over in this slice. A review that failed on an exhausted LLM budget was approved with a notice; on the external floor it fails, is retried once, and leaves a red check. The review body named the model that judged the diff; a station's brief does not carry it.

## Reaching the floor

- FR1.1 — Lore reaches the floor through one client built from `FLOOR_API_URL` and `FLOOR_SERVICE_TOKEN` (`libs/shared/src/outbound/floor/floor-client.ts`); a deployment that sets neither has no floor, and building the client without both is refused by name.
- FR1.2 — A repository is spelled `github.com/owner/name`, lowered, on the floor; a branch keeps its case; a run's start items are written by kind as `git`, `value` and `file`; and a pull request's address is read back into its repository and number, with anything that is not a GitHub pull request address refused (`libs/shared/src/outbound/floor/floor-items.ts`).

## The pipelines

- FR2.1 — The review lines are floor pipeline files under `libs/assembly-lines/src/floor-pipelines/` — `code-review`, `code-review-recheck`, `code-review-reply` and `lore-run-settled` — each holding its line, its stations and its agent definitions with the prompt inline.
- FR2.2 — `code-review` walks `review → post-review → done`, has no refine node, and retries a failed review visit once before the run fails; `code-review-recheck` walks `recheck → post-review → done` on `gemini-3.1-pro-preview` with the same single retry.
- FR2.3 — Only `code-review` marks `pr_url` as its subject, so a second review of an open pull request joins the run already open, while a re-check or a reply never joins an open review and judges nothing.
- FR2.4 — `code-review-reply` enters at `read-review`, and its agent station clones the repository with write access, because nothing pushes the pod's commit for it.
- FR2.5 — Every review agent station takes the optional file need `issue` at `issue.md`, and `post-review` takes `head_sha` as an optional need.
- FR2.6 — `lore-run-settled` starts on the floor's own `internal.run.settled` event, which is how Lore hears that a run ended.
- FR2.7 — Every review agent runs with test policy `none`, and the prompts that ask for `REVIEW_FINDINGS` show a whole finding, so no model guesses the shape.
- FR2.8 — The code-review prompt reads the change as its user first, leaves lint, types, formatting and tests to CI's verdict, reads the diff once in place, queries context with the pull request's subject, and reserves `changes_requested` for a defect or a spec mismatch.
- FR2.9 — The code-review-recheck prompt judges the range since the sha the last verdict judged, under the same CI-verdict and read-once rules, and queries context with the pull request's title and the surface the new commits change.

## Seeding

- FR3.1 — At boot, before it listens, lore-api seeds each pipeline whose line the floor does not have, and leaves a line that exists alone, so an edit made on the floor survives a Lore deploy (`apps/lore-api/src/work/floor/seed-floor-pipelines.ts`, `apps/lore-api/src/app/seed-floor.ts`).
- FR3.2 — A pipeline's `${NAME}` placeholders are filled from the environment, and one with no value is refused by name rather than seeded half-written.
- FR3.3 — A floor out of reach is logged and does not stop the boot, and a deployment with no floor configured reads no pipeline file.

## Starting and ending reviews

- FR4.1 — A pull request opened or pushed to starts `code-review` when no review has run on it and `code-review-recheck` when one has, in a repository with `auto_review` on; a run of another pull request in the same repository does not count (`libs/shared/src/work/review/floor-review-start.ts`).
- FR4.2 — `code-review` is started on the pull request's branch with its address, a description and its head sha, and the run is announced on the pull request with a link to its run page — once: a start that joined an open run posts nothing.
- FR4.3 — A draft or closed pull request starts nothing.
- FR4.4 — When the pull request's body names an issue with `Closes`, `Fixes`, `Resolves` or `Refs`, the issue's title and body are stored on the floor as a file and passed as the `issue` start item; a pull request that names none starts without one (`linkedIssueNumber` in `libs/shared/src/domain/pr-body.ts`).
- FR4.5 — A re-check names the sha the last verdict judged, and none starts while an open run is already judging the head sha.
- FR4.6 — A review asked for by hand — an `@lore review` comment from a person, or the run page's "Trigger review" through `POST /api/review/start` — is forced past the `auto_review` gate and cancels an open re-check as superseded; a bot's comment and a plain comment start nothing.
- FR4.7 — A submitted review that requests changes starts `code-review-reply` with the review's id and the `address` intent, only for a reviewer GitHub attributes write standing to (`OWNER`, `MEMBER`, `COLLABORATOR`, carried as `review_author_association`); an approval, a bot's review and a stranger's start nothing.
- FR4.8 — A closed pull request cancels its open review-family runs as `pr_closed`, whatever `auto_review` says, and leaves finished runs alone.
- FR4.9 — The stations service subscribes to the pull-request events only on a deployment with a floor, and answers every event name it subscribes to (`apps/stations/src/events/floor-review-handlers.ts`).
- FR4.10 — `auto_review` is read off the repository's settings, whether they were stored as an object or as JSON text.

## The stations

- FR5.1 — `post-review` reads the agent's output, posts its findings as one review — inline where GitHub takes a comment, in the body where it does not, as a `COMMENT` review on a pull request the reviewer authored, and as a plain comment when every review shape is refused — and approves visibly when the verdict is an approval with no findings (`apps/stations/src/code-review/post-review/`).
- FR5.2 — Every posted review and reply ends with the line saying the floor posted it and for which visit, then a hidden per-visit marker; a visit whose marker is already on the pull request posts nothing again.
- FR5.3 — `post-review` publishes the verdict as the `lore/code-review` check on the head sha — `success` for an approval, `neutral` for changes requested — reading the sha off the pull request when the run was started without one, and reports a summary and the pull request's address.
- FR5.4 — `post-review` fails its visit when the output carries no verdict, when the address is not a pull request, and when every way of posting is refused.
- FR5.5 — `read-review` gathers a submitted review's body and its inline comments, read from the pull request's own comment list, into one feedback text, and falls back to a fixed sentence when the review says nothing (`apps/stations/src/code-review/read-review/`).
- FR5.6 — `post-reply` posts the agent's reply in the thread of the comment it answers, or on the pull request when there is none, resolves the thread only for an `address` intent, and fails its visit when the output carries no reply (`apps/stations/src/code-review/post-reply/`).
- FR5.7 — `run-settled` publishes a failed `lore/code-review` check, with the run's reason and how to re-run, when a review or re-check run settles as `failed` or `error`; a cancelled run, a successful run and a run of any other line publish nothing (`apps/stations/src/code-review/run-settled/`).

## Git credentials

- FR6.1 — `POST /api/floor/git-credential` answers the floor's request with a freshly minted installation token for the one repository named, as the `x-access-token` username and password pair (`apps/lore-api/src/transport/routes/floor/git-credential.ts`).
- FR6.2 — The request is refused with 401 for a missing or wrong bearer, with 503 on a deployment given no `FLOOR_GIT_CREDENTIAL_TOKEN`, and with 400 for an address that is not a `github.com` repository; nothing is minted for a refused request.

## The run page

- FR7.1 — A run the floor holds is read in the models the run page already reads: its line version's nodes and edges as the graph, its start items as args stamped `engine: floor`, its visits as station runs named `floor-<visit id>`, and a run the floor does not have as absent (`apps/lore-api/src/work/floor/floor-run-reader.ts`, `floor-run-mapping.ts`).
- FR7.2 — A run's status is `queued` before any visit, `running` while open, `failed` when it settled as `error`, `failed` or `cancelled`, and `finished` otherwise; a visit is `queued`, `claimed` once it has a deadline and `running` once a worker holds it or it reported.
- FR7.3 — A visit's agent settings, prompt included, never reach the browser: neither a station run nor a live frame carries them.
- FR7.4 — Every run read answers from Postgres first and from the floor when Postgres has no such run, so the routes and the live socket see a floor run without knowing there are two engines (`apps/lore-api/src/work/floor/floor-backed-runs.ts`).
- FR7.5 — A floor run is followed over the browser's existing run channel: the viewer gets the run and its visits, then the floor's journal relayed from its cursor, then `catchup_complete`; turns become agent events, visit frames become node statuses, a settled run becomes a run status, and records the page does not draw are dropped (`floor-frames.ts`, `floor-run-feed.ts`).
- FR7.6 — An agent event's id is the journal's seq times one hundred plus the row's place in its turn, so ids stay numeric and ordered; a viewer's cursor is turned back into the seq to ask the floor for, and a row at or below the cursor is not sent again.
- FR7.7 — Leaving the channel stops the floor watch, a viewer too far behind is dropped as slow, and a watch the floor refuses ends the viewer as an error.
- FR7.8 — `GET /api/assembly-runs/{id}/turns` pages a floor run's untruncated turns, numbered by their place in the run, and the run page reads a floor run's turns from lore-api and every other run's from Lore's Floor (`apps/lore-api/src/transport/routes/floor/run-turns.ts`, `apps/web-ui/src/lib/run-turns-upstream.ts`).
- FR7.9 — A floor run's cost is the floor's own sum for the run.

## Open Questions

- The runs list reads Postgres only, so a floor run is reachable by its link and not from the list.
- "Retry from node" and "Run this station" are still offered on a floor run and are refused by lore-api, which has no such run to fork.
- The `comment-triage` line has no trigger and no follow-up left on Lore's Floor; it is removed with the slice that moves or retires it.
