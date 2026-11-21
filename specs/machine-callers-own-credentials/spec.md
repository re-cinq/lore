# Feature Specification: Callers that are not people have their own credentials

| Field     | Value |
| --------- | ----- |
| Feature   | Callers that are not people have their own credentials |
| Branch    | machine-callers-own-credentials |
| Status    | In Progress |
| Created   | 2026-11-19 |
| Owner     | Platform Engineering |
| Builds on | [ADR-054](../../adrs/ADR-054-github-decides-who-can-open-a-repository.md), [`specs/github-decides-repo-access/spec.md`](../github-decides-repo-access/spec.md) |

A caller that is not a person has no GitHub identity to honour, so each gets a credential that can do its one job and nothing else, and none of them is the shared admin token. This spec states Step 4 of [ADR-054](../../adrs/ADR-054-github-decides-who-can-open-a-repository.md) as requirements a test can prove. Steps 1 to 3, which are about people, are [`specs/github-decides-repo-access/spec.md`](../github-decides-repo-access/spec.md), called the first spec below. Requirement numbers are unique across the two specs.

## Problem Statement

The value of `lore-ingest-token` is every scope with no expiry and no owner, and lore-api accepts it from its environment without a database row. The MCP gateway, the stations service and its scheduled jobs, every onboarded repository's CI, every developer's laptop and the VS Code extension hold it. One signing secret verifies every repository's webhook. ADR-054 has the full account and the reasons; this spec repeats neither.

## User Scenarios

### User Story 1 - One leaked machine credential opens one repository (Priority: P1)

A repository's CI, an agent run and a repository's webhook each hold a credential that works for that repository only. The token that opens the whole install is gone.

**Why this priority**: one token with every scope sits in every repository's secrets, in the gateway and on laptops today.

**Independent Test**: use one repository's CI credential and one run's gateway credential against another repository.

### User Story 2 - An existing install moves without a break (Priority: P1)

An operator upgrades an install that has onboarded repositories. Lore moves each repository's webhook and installed workflows to their own credentials, shows which are not moved yet and which still use the shared token, and the shared token is withdrawn only when nothing has used it for 30 days. A rollback at any point leaves CI and webhooks working.

**Why this priority**: every onboarded repository holds the shared token today, and a cut-over that breaks ingest would be noticed late.

**Independent Test**: upgrade an install with two onboarded repositories, one of which has a workflow of its own that reads the secret; run the reconciliation job; roll back; upgrade again.

## Requirements

This step takes two releases so that a rollback works. The first only adds: lore-api accepts both the old and the new credentials. Repositories are moved once that release is the one a rollback returns to. "The first Step 4 release" is that first release. A level is GitHub's permission on a repository, as in the first spec. The requirements for an agent run's GitHub credential are here and not in the first spec because ADR-054's order of work builds them in Step 4.

### A repository's CI

A run of the ingest client makes many requests (it reads the ingest state, posts each kind of document in parts, and retries), and it can last longer than one identity token. So a token is not single-use: it is good for its own short life, which GitHub sets in minutes, and only for the ingest routes of its one repository. Sending it again gives its holder nothing the workflow does not already do.

- **FR-070**: lore-api accepts a GitHub Actions identity token for ingest only when its issuer is exactly the configured GitHub host's ([validated by accepts a token for ingest only when its issuer is exactly the configured GitHub host issuer @3b69bd2c](apps/lore-api/src/transport/http/ci-identity-token.acceptance.test.ts#L55)) ([validated by returns claims only when the issuer is exactly the configured GitHub host issuer @28f46d6d](apps/lore-api/src/transport/http/ci-identity-token.test.ts#L43)) ([validated by gives a verified CI identity token write scope only, with no user and no token hash @496a547f](apps/lore-api/src/transport/http/resolve-principal.test.ts#L80)) ([validated by falls through to the stored token lookup when a JWT-shaped bearer does not verify @312f937d](apps/lore-api/src/transport/http/resolve-principal.test.ts#L107)).
- **FR-151**: An identity token is accepted only when its signature matches a key of the key set that issuer publishes ([validated by accepts a token only when its signature matches a key published by the issuer key set @cfac12a0](apps/lore-api/src/transport/http/ci-identity-token.acceptance.test.ts#L88)) ([validated by returns claims only when the signature matches a key of the issuer key set @e96e3b94](apps/lore-api/src/transport/http/ci-identity-token.test.ts#L64)) ([validated by refuses a token whose header names an algorithm other than RS256 @3959237f](apps/lore-api/src/transport/http/ci-identity-token.test.ts#L122)) ([validated by refuses when the issuer key set errors, rejects or answers something that is not a key set @bb405462](apps/lore-api/src/transport/http/ci-identity-token.test.ts#L134)).
- **FR-152**: lore-api fetches the key set from the configured issuer and from nowhere else ([validated by fetches the key set only from the configured issuer origin @244d3019](apps/lore-api/src/transport/http/ci-key-set.acceptance.test.ts#L63)) ([validated by fetches the key set only from the configured issuer origin @244d3019](apps/lore-api/src/transport/http/ci-key-set.test.ts#L24)) ([validated by refuses a key set the issuer origin redirects to another host @6999619a](apps/lore-api/src/transport/http/ci-key-set.test.ts#L70)) ([validated by refuses an openid configuration whose jwks_uri is missing, not a URL or names another host through userinfo @58ea8f9f](apps/lore-api/src/transport/http/ci-key-set.test.ts#L155)) ([validated by never answers one issuer's lookup with another issuer's keys, kept or in flight @0b98642a](apps/lore-api/src/transport/http/ci-key-set.test.ts#L202)).
- **FR-153**: An identity token signed with a key id lore-api does not hold triggers a fetch of the key set, unless one was made in the last minute ([validated by refetches on an unknown key id at most once per minute and refuses keys still missing @4df133e8](apps/lore-api/src/transport/http/ci-key-set.acceptance.test.ts#L170)).
- **FR-350**: At most one fetch of the key set is in flight, and a token that needs the key set meanwhile waits for that fetch ([validated by shares one fetch between concurrent lookups and serves later ones from the cache @1b395332](apps/lore-api/src/transport/http/ci-key-set.test.ts#L49)) ([validated by keeps at most one key-set fetch in flight while concurrent requests wait for it @d4cf4bb6](apps/lore-api/src/transport/http/ci-key-set.acceptance.test.ts#L119)).
- **FR-351**: For one minute after a fetch, a token whose key id is unknown is refused without another fetch ([validated by refetches on an unknown key id at most once per minute and refuses keys still missing @4df133e8](apps/lore-api/src/transport/http/ci-key-set.acceptance.test.ts#L170)).
- **FR-218**: An identity token whose key id is still unknown after that fetch is refused ([validated by refetches on an unknown key id at most once per minute and refuses keys still missing @4df133e8](apps/lore-api/src/transport/http/ci-key-set.acceptance.test.ts#L170)).
- **FR-154**: An identity token is refused when its key cannot be confirmed because the key set could not be fetched ([validated by refuses identity tokens when the key set cannot be fetched @2ae90858](apps/lore-api/src/transport/http/ci-key-set.acceptance.test.ts#L204), [validated by rejects when the issuer never answers and lets the next lookup fetch afresh @402c9f6f](apps/lore-api/src/transport/http/ci-key-set.test.ts#L105)) ([validated by refuses when the issuer's own origin answers something that is not a key set @28367a90](apps/lore-api/src/transport/http/ci-key-set.test.ts#L124)).
- **FR-155**: A kept key set is used for at most one hour after it was fetched ([validated by keeps a key set for at most one hour and respects shorter but not longer cache headers @d4a4ba14](apps/lore-api/src/transport/http/ci-key-set.acceptance.test.ts#L254)).
- **FR-408**: The issuer's cache headers can shorten that hour and never lengthen it ([validated by keeps a key set for at most one hour and respects shorter but not longer cache headers @d4a4ba14](apps/lore-api/src/transport/http/ci-key-set.acceptance.test.ts#L254)).
- **FR-409**: When the issuer's answer carries no cache header, or one that cannot be read, the key set is kept for one hour.
- **FR-410**: A token signed by a key of a set older than that is not accepted until the set has been fetched again.
- **FR-071**: An identity token whose audience is not this install's own address is refused ([validated by refuses a token whose audience is not this install address @7a5b3acb](apps/lore-api/src/transport/http/ci-identity-token.acceptance.test.ts#L112)) ([validated by refuses every token when this install's address is not configured @c7071b56](apps/lore-api/src/transport/http/ci-identity-token.test.ts#L165)).
- **FR-072**: An identity token outside its validity period (`iat`, `nbf`, `exp`) is refused ([validated by refuses a token outside its validity period across iat, nbf, and exp @b8b773f3](apps/lore-api/src/transport/http/ci-identity-token.acceptance.test.ts#L130)) ([validated by refuses a token whose validity claims are missing or not numbers @ef0797aa](apps/lore-api/src/transport/http/ci-identity-token.test.ts#L174)).
- **FR-074**: An identity token is accepted only when its `repository_id` and `repository_owner_id` match an onboarded repository ([validated by accepts a token only when repository_id and repository_owner_id match an onboarded repository @f4f39355](apps/lore-api/src/transport/http/ci-identity-token.acceptance.test.ts#L155)) ([validated by refuses when the onboarded repository lookup fails or the claims are not strings @fabb89f3](apps/lore-api/src/transport/http/ci-identity-token.test.ts#L198)).
- **FR-156**: An accepted identity token from a run on the repository's default branch allows `POST /api/repos/{owner}/{repo}/ingest` and `GET /api/repos/{owner}/{repo}/ingest-state` of the repository it names, and no other repository.
- **FR-312**: An accepted identity token from a run on the repository's default branch allows `POST /api/ingest`, the route the installed workflow's `ingest` job posts to, only when the `repo` in the payload is the repository the token names.
- **FR-313**: `POST /api/ingest` made with an identity token whose repository is not the payload's `repo` is refused.
- **FR-267**: An identity token is accepted for as long as it is valid, so the same token can be sent on more than one request of a run.
- **FR-075**: An identity token is accepted whichever workflow file of the repository ran, and what it allows follows from the ref it ran on (FR-156, FR-312, FR-157, FR-287).
- **FR-157**: An identity token from a run on a ref other than the repository's default branch is refused on the ingest routes of FR-156 and FR-312.
- **FR-287**: An accepted identity token from a run on any ref of the repository allows `GET /api/repos/{owner}/{repo}/impact/base` and `POST /api/repos/{owner}/{repo}/impact` of the repository it names, and `POST /api/spec-links/parse`, and no other route.
- **FR-076**: An identity token from a pull request of a fork is refused.
- **FR-077**: lore-api issues no longer-lived credential in exchange for an identity token.
- **FR-268**: The ingest client (`apps/lore-code-trace`) asks GitHub for the identity token itself, at the request URL and with the request token that Actions gives a job with `id-token: write`.
- **FR-269**: The ingest client asks for that token with this install's address as its audience.
- **FR-270**: The ingest client asks for a new identity token when the one it holds is less than a minute from its expiry.
- **FR-271**: The ingest client asks for a new identity token, and sends the request once more, when lore-api answers a request `401`.
- **FR-272**: The installed workflow passes no identity token to a step in an environment variable.
- **FR-078**: Where the identity token cannot be used, a repository's CI holds a stored token of a kind of its own in `pipeline.api_tokens` (beside `service` and `user`), bound to that repository's GitHub numeric id.
- **FR-314**: A repository's stored CI token is accepted on the routes an identity token is (`POST /api/ingest` with its own repository in the payload, `POST /api/repos/{owner}/{repo}/ingest`, `GET /api/repos/{owner}/{repo}/ingest-state`, `GET /api/repos/{owner}/{repo}/impact/base`, `POST /api/repos/{owner}/{repo}/impact`, `POST /api/spec-links/parse`). It carries no ref, so it is not split by branch.
- **FR-315**: A repository's stored CI token is refused on every other route, whatever scope that route declares.
- **FR-158**: A repository's stored CI token is refused for any other repository.
What calls Lore from a repository's CI today, each with the admin token from the repository secret `LORE_INGEST_TOKEN`:

| Caller | Where it is defined | Runs on | Routes it calls |
| --- | --- | --- | --- |
| The `ingest` job | the workflow Lore installs (`libs/shared/src/work/ingest-workflow.ts`) | push to the default branch | `POST /api/ingest` |
| The `graph` job (`lore-code-trace docs --post`) | the same workflow | push to the default branch | `GET .../ingest-state`, `POST .../ingest` |
| The test report (`lore-code-trace --post`) | `.github/workflows/lore-tests.yml`, written by an agent from Lore's instruction (`libs/shared/src/lib/lore-tests-instruction.ts`) | push to the default branch, a schedule, a manual run | `GET .../ingest-state`, `POST .../ingest` |
| Trace impact | the workflow Lore installs (`libs/shared/src/work/trace-impact-workflow.ts`) | a pull request | `GET .../impact/base`, `POST .../impact` |
| The spec-link check (`lore-code-trace links`) | a workflow of the repository's own | a pull request | `POST /api/spec-links/parse` |

A test report is a write of that repository's test results. It runs on the default branch, so it falls under the default-branch rule of FR-156, and a manual run on another branch is refused like any ingest from one. The binary itself is fetched from `/dist/lore-code-trace/...`, which needs no credential.

- **FR-316**: The `ingest` job of the installed workflow asks GitHub for an identity token in its own step, with this install's address as its audience, and sends it on its one request.
- **FR-317**: Lore's instruction for `lore-tests.yml` tells its author to grant the job `id-token: write` and `contents: read` and not to read `LORE_INGEST_TOKEN`.
- **FR-318**: The trace-impact workflow Lore installs is granted `id-token: write` beside the permissions it has today (`contents: read`, `checks: write`, `pull-requests: write`), and does not read `LORE_INGEST_TOKEN`.
- **FR-369**: Each step of the trace-impact workflow that calls Lore asks GitHub for an identity token, with this install's address as its audience, immediately before its request.
- **FR-370**: A step of that workflow whose request is answered `401` asks for a new identity token and sends the request once more.
- **FR-445**: An install setting (`LORE_CI_IDENTITY_TOKENS` under `lore-platform.lore-api.env`, `true` or `false`) says whether the GitHub host's identity tokens carry `repository_id` and `repository_owner_id`.
- **FR-446**: With that setting unset and `GITHUB_HOST` unset, the install is treated as `true`.
- **FR-447**: With that setting unset and `GITHUB_HOST` set, lore-api does not start from the first Step 4 release on.
- **FR-448**: Onboarding sets the repository's Actions variable `LORE_CI_AUTH` to `identity` on an install set to `true` and to `token` on an install set to `false`.
- **FR-449**: The reconciliation job of FR-241 sets the same variable on a repository when it moves it, and leaves it as it is on a repository already moved.
- **FR-484**: The repository's row in `lore.repos` records the mode (`identity` or `token`) the repository was onboarded or moved under.
- **FR-485**: From the first Step 4 release, lore-api does not start when the setting of FR-445 gives a mode other than the one recorded on an onboarded repository's row, and its error names the setting `LORE_CI_IDENTITY_TOKENS`.
- **FR-450**: The workflows Lore installs pass `vars.LORE_CI_AUTH` to each step that calls Lore.
- **FR-319**: Every command of the client that calls lore-api (`docs --post`, `--post`, `links`) gets its credential the way FR-268 to FR-271 say when `LORE_CI_AUTH` is `identity`.
- **FR-320**: When `LORE_CI_AUTH` is `token`, the client reads the repository's stored CI token of FR-078 from its environment, even when Actions offers the identity-token request URL.
- **FR-451**: The client never chooses its credential by whether Actions offers the request URL.
- **FR-452**: When `LORE_CI_AUTH` is not set, the repository has not been moved, and the client reads `LORE_INGEST_TOKEN` as it does today.
- **FR-079**: The first Step 4 release accepts an ingest request with either the stored token or the identity token.
- **FR-159**: After a rollback to the first Step 4 release, a workflow already moved to the identity token still ingests.

### Agent runs

- **FR-080**: A run started by a person records that person's GitHub numeric id (the id sign-in stores, first spec).
- **FR-160**: A run records its repository's GitHub numeric id.
- **FR-081**: Each time the floor asks `POST /api/floor/git-credential` for the GitHub credential of a run a person started, lore-api asks GitHub, as the App, for that person's level on the repository, and mints the access the station asks for only when the level is `write` or above.
- **FR-082**: When that person's level is below `write`, lore-api issues no credential and the run is cancelled.
- **FR-210**: For a run started by an event, the person of FR-081 and FR-082 is the event's author: when the author's level is `write` or above, the run gets the access its station asks for.
- **FR-211**: For a run started by an event whose author's level is below `write`, in a repository whose setting of FR-090 is on, `POST /api/floor/git-credential` issues a `read` token whatever access the station asks for.
- **FR-212**: A run of FR-211 is not cancelled because its author lacks `write`.
- **FR-213**: An event author that is missing, or that cannot be resolved to a GitHub numeric user id, is treated as below `write`.
- **FR-214**: For a run started by a schedule, no person is asked about, and `POST /api/floor/git-credential` issues the access the station asks for, for the run's one repository.
- **FR-215**: A run records how it was started: a person, an event with its author, or a schedule.
- **FR-219**: `POST /api/floor/git-credential` refuses a run that records none of them.
- **FR-184**: Every GitHub installation token lore-api issues for a run, however the run started, names exactly one repository, the run's, by its GitHub numeric id.
- **FR-185**: A credential request that names no repository is refused, and is never answered with a token for the whole installation.
- **FR-186**: A token issued for `read` access carries contents and metadata read and nothing else (`podPermissions`).
- **FR-187**: A token issued for `write` access carries contents, pull requests, issues and workflows write, metadata read, and nothing else.
- **FR-188**: No GitHub credential is issued for a run that is not active.
- **FR-189**: No GitHub credential is issued for a visit that has ended.
- **FR-190**: After a token is minted, lore-api asks the floor for the run's state again, and when the run has ended or been cancelled meanwhile it marks the token's row for revocation and does not return the token.
- **FR-191**: A token handed over while the run's cancellation was in progress is marked by the worker of FR-455 at its next pass at the latest.
- **FR-083**: After a run ends or is cancelled, every installation token lore-api minted for it is marked within a minute of the floor answering, and is then revoked at GitHub or has expired; none is left that nobody is revoking.
- **FR-453**: Before it hands an installation token to the floor, lore-api stores it, encrypted with the key that encrypts people's stored tokens (FR-025 of the first spec), in a row of a table of its own with the token's run, visit and expiry.
- **FR-454**: lore-api sets that row to handed over in the transaction of FR-190's second read, and returns the token only after that transaction has committed.
- **FR-455**: A worker in lore-api, at most one minute apart, takes every run that has a stored token neither revoked nor expired and asks the floor for that run's state, through the floor's client (`FloorClient`, as `apps/lore-api/src/work/floor/cancel-run.ts` uses it).
- **FR-479**: That worker marks for revocation every row of a run the floor reports ended or cancelled.
- **FR-480**: That worker marks for revocation every row of a run the floor does not know.
- **FR-481**: When the floor cannot be reached, that worker marks nothing and asks again at its next pass.
- **FR-482**: lore-api's own cancel route (`POST /api/assembly-runs/{id}/cancel`) marks the run's rows as soon as the floor has confirmed the cancellation, without waiting for the worker.
- **FR-456**: A second worker in lore-api, which minted the token and holds the key, revokes each marked token at GitHub (`DELETE /installation/token`, sent with that token).
- **FR-457**: A revocation GitHub does not confirm is tried again until GitHub confirms it or the token's expiry has passed.
- **FR-458**: When GitHub confirms a revocation, the row's stored token is deleted.
- **FR-459**: A row whose token's expiry has passed has its stored token deleted, whatever its state.
- **FR-460**: After lore-api restarts, the worker goes on from the rows the table holds; nothing about a revocation is kept only in memory.

A minted installation token is in one of these states, and moves only along these lines:

| State | Entered when | Left for |
| --- | --- | --- |
| minted | the row is stored, before the second read of the run's state (FR-453) | handed over, when the run is still active (FR-454); marked, when it is not (FR-190) |
| handed over | the second read found the run active (FR-454) | marked, when the worker finds the floor reports the run ended, cancelled or unknown, or the cancel route had the floor's confirmation (FR-479, FR-480, FR-482); expired, when its hour passes first (FR-459) |
| marked | the floor reported the run ended, cancelled or unknown (FR-479, FR-480, FR-482), or the second read found it so (FR-190) | revoked, when GitHub confirms (FR-458); expired, when its hour passes first (FR-459) |
| revoked | GitHub confirmed the revocation (FR-458) | nothing; the stored token is deleted |
| expired | the token's expiry passed (FR-459) | nothing; the stored token is deleted |

The floor owns a run's state and lore-api only reads it, so lore-api has no moment of its own at which a run ends. The worker of FR-455 is what guarantees the marking; the cancel route's own marking only makes it sooner. While the floor cannot be reached nothing is marked, and the token's expiry, one hour after its minting, bounds how long a token of an ended run can work.

- **FR-084**: A run goes on after its starter signs out.
- **FR-085**: The MCP gateway accepts from an agent pod only the token the floor signed for that visit.
- **FR-192**: The gateway verifies a visit's token with the floor's public key and holds no key that can sign one.
- **FR-086**: lore-api verifies a visit's token the gateway forwards, with the same public key.
- **FR-193**: lore-api applies the repository guard to a visit's token, so an agent's call for a repository other than its run's is refused.
- **FR-087**: A visit's token is refused after the visit ends.
- **FR-088**: A visit's token carries the scopes it may use.
- **FR-194**: The gateway refuses a tool that needs a scope the visit's token does not carry, also for the token's own repository.
- **FR-089**: An agent's visit token carries only the scopes for reading and writing Lore's context of its run's repository.
- **FR-161**: lore-api refuses a visit's token on every organisation-wide route.
- **FR-162**: lore-api refuses a call made with a visit's token that acts on a run other than its own.

The gateway token of FR-085 to FR-162 is a credential for Lore. The installation token of FR-081 to FR-191 and FR-210 to FR-215 is a credential for GitHub. They are two tokens with two sets of rules. The gateway token's encoding, the rotation of the floor's key and what a long visit does at expiry are deferred to a spec of their own, to be written before Step 4 starts. What each token may do is stated above and is not deferred.

### Runs Lore starts itself

- **FR-090**: A pull request from an author without `write` starts a review only when the repository's setting for it is on.
- **FR-094**: That setting is off by default.
- **FR-091**: The GitHub token of a run started by an event whose author has no `write` is the `read` token of FR-211.
- **FR-095**: The gateway offers such a run no tool that writes in Lore.
- **FR-092**: The findings of such a run are posted as a comment, never as an approving review or a passing check.
- **FR-093**: A scheduled job authenticates with the stations token.

### Stations, laptops and the editor

- **FR-100**: The stations service and its scheduled jobs authenticate to lore-api with a named system token of a kind of its own (`LORE_STATION_TOKEN`, which the stations code already prefers to `LORE_INGEST_TOKEN`).
- **FR-344**: lore-api accepts the stations token only on the routes of a list a test holds, each with the scope that route declares.
- **FR-345**: That list starts as the routes the stations service calls today: the plan routes under `/api/plans`, `/api/pack/sync`, `/api/session-summary`, `/api/context`, `/api/versions`, `/api/utopia/memory`, `/api/repos/{owner}/{repo}/webhook/ensure` and `/api/repos/{owner}/{repo}/utopia/` with `tracker`, `releases`, `commits` and `backfill`.
- **FR-346**: lore-api refuses the stations token on every route outside that list.
- **FR-347**: A test fails when code of the stations service calls a lore-api route that is not on the list, so a job that needs another route adds it in the same change.
- **FR-348**: The courier CronJobs authenticate to the stations service's `/api/stations/{name}` routes with the stations token, in place of `LORE_INGEST_TOKEN` (`apps/stations/src/transport/server.ts`).
- **FR-349**: In a rendered install, the Secret that holds the stations token is read only by the stations Deployment and by the CronJobs named `<chart>-courier-<job>`, and the check of the rendered chart (`scripts/check-lore-platform-render.sh`) fails otherwise.
- **FR-101**: The stations token can be replaced without changing any other credential.
- **FR-102**: The local MCP server signs a person in through a pairing with lore-api and holds a session for that person.
- **FR-103**: The VS Code extension signs a person in through a pairing with lore-api and holds a session for that person.
- **FR-416**: lore-api answers a client that holds no credential, at a route this spec introduces (`POST /api/auth/pairings`), with a short code for the person and a secret the client keeps.
- **FR-426**: lore-api stores a hash of a pairing's secret, and not the secret.
- **FR-417**: The client shows the person the code and a link to the web UI's pairing page, which this spec introduces (`/auth/pair`).
- **FR-427**: The pairing page shows the kind of client that asked and when it asked, before the person confirms.
- **FR-418**: A signed-in person confirms the code on that page, which calls a route this spec introduces (`POST /api/auth/pairings/confirm`) with their session.
- **FR-419**: A confirmation is accepted only from a session that passes the membership check of FR-236 of the first spec.
- **FR-420**: The client asks a route this spec introduces (`POST /api/auth/pairings/claim`) with its secret and, once the pairing is confirmed, receives a session for the person who confirmed it.
- **FR-467**: `POST /api/auth/pairings/claim` creates the session under the person's lock of the first spec (FR-388), and only when the generation recorded on the confirming session equals the person's generation (FR-434 to FR-437 of the first spec); the new session records that generation.
- **FR-421**: A pairing that is not confirmed within ten minutes of its creation is refused at both routes.
- **FR-422**: A pairing yields one session: a second claim with the same secret is refused.
- **FR-423**: The session of a pairing is a person's session, and every rule of the first spec for a person's session holds for it (levels, the five-minute membership and repository answers, the ending of every session of a person).
- **FR-424**: The session of a pairing stores no GitHub token of its own: for its requests lore-api uses a stored GitHub token of the same person, found by their GitHub numeric user id among their sessions that hold one.
- **FR-425**: When that person has no session that holds a stored token, a request of a pairing's session that needs GitHub is refused with an answer that tells the person to sign in on the web, and the session is kept.
- **FR-352**: lore-api tells a client that holds no credential whether pairing sign-in is on, at a route this spec introduces (`GET /api/auth/pairings/available`).
- **FR-353**: Against an install that says it is on, the local MCP server sends its session and does not read `lore.ingest-token` from git config or `LORE_INGEST_TOKEN` from its environment.
- **FR-354**: Against such an install, the VS Code extension sends its session and reads neither its `lore.token` setting nor `lore.ingest-token` from git config (`resolveCredentials` in `apps/vscode-extension/src/extension.ts`).
- **FR-355**: Against such an install, a client that holds no session and finds a legacy token asks the person to sign in and does not send the legacy token.
- **FR-356**: After a successful pairing sign-in, the client removes `lore.ingest-token` from the global git config.
- **FR-357**: After a successful pairing sign-in, the VS Code extension clears its `lore.token` setting.
- **FR-411**: The VS Code extension keeps its session in the editor's SecretStorage.
- **FR-412**: The local MCP server keeps its session in the operating system's credential store.
- **FR-413**: Where the operating system offers no credential store, the local MCP server keeps its session in a file in the user's configuration directory that only that user can read (mode `0600`).
- **FR-414**: Neither client writes a session to editor settings, to git config or to an exported environment variable.
- **FR-415**: Neither client writes a session to a log or to telemetry.
- **FR-358**: `scripts/install.sh` no longer writes `lore.ingest-token` to git config and no longer tells the person to read the Secret `lore-ingest-token` from the cluster.
- **FR-359**: `scripts/lore-doctor.sh` and `scripts/lore-status-cache.sh` use the person's session and no longer read `lore.ingest-token`.
- **FR-360**: The README's setup steps no longer tell a developer to copy the token into git config.
- **FR-361**: Sign-out in a client deletes the session from wherever the client keeps it (FR-411 to FR-413) and ends it in lore-api.
- **FR-362**: Against an install that does not say pairing sign-in is on, a client goes on using the legacy token.

The pairing is Lore's own and uses nothing of GitHub's device flow: it works the same on GitHub.com and on a GitHub Enterprise Server version where the device flow is unconfirmed, and it needs no extra setting on the App. The person proves who they are in the web UI, where they are already signed in through GitHub.

Today the web UI's settings page shows the shared admin token with a copy button, a command that installs it and a button that regenerates it (`apps/web-ui/src/app/settings/SettingsView.tsx`, `page.tsx`), and `GET /api/settings` (`apps/lore-api/src/transport/routes/repos/org-settings.ts`) returns it with the other settings to any signed-in member.

- **FR-399**: From the first Step 4 release, the web UI's settings page does not show the ingest token.
- **FR-400**: From that release, the settings page offers no button that copies the ingest token and none that regenerates it.
- **FR-401**: From that release, the settings page shows no install command and no instruction that carries the ingest token.
- **FR-402**: From that release, `GET /api/settings` does not return `ingest_token`.
- **FR-403**: From that release, `PUT /api/settings` refuses a body that carries `ingest_token`.
- **FR-405**: From that release, lore-api takes the shared admin token only from its own configuration (its environment) and never from the stored setting, also after a rollback to that release.
- **FR-404**: The stored setting `ingest_token` is deleted when the shared admin token is withdrawn (FR-121).

### Webhook secrets

- **FR-110**: Each repository's webhook has a signing secret of its own, in place of the one `LORE_WEBHOOK_SECRET` for all.
- **FR-115**: A repository's webhook secret is stored encrypted, against the repository's GitHub numeric id.
- **FR-371**: The reconciliation job and onboarding store a repository's own secret before they change its webhook on GitHub.
- **FR-372**: A retry of a webhook move uses the secret already stored for that repository and never generates another.
- **FR-373**: A repository's row is marked as moved for its webhook (FR-248) only after lore-api has verified a delivery signed with that repository's own secret; the job asks GitHub to send the webhook a ping for it.
- **FR-374**: For a repository that has a stored secret and is not marked moved, lore-api accepts a delivery signed with either the shared secret or the repository's own.
- **FR-375**: A webhook move interrupted at any point is finished by the job's next run, and no delivery is refused in between.
- **FR-111**: The first Step 4 release accepts a delivery signed with either the shared secret or the repository's own.
- **FR-112**: After a rollback to the first Step 4 release, a delivery from a repository already moved to its own secret is still accepted.
- **FR-113**: Once no webhook uses the shared secret, a delivery signed with it is refused.

A webhook move has three steps, and GitHub never shows a webhook's secret back, so the only proof that GitHub holds the new one is a delivery signed with it. What holds at each point where the move can stop:

| Stopped after | The webhook on GitHub signs with | lore-api accepts | The next run |
| --- | --- | --- | --- |
| the secret is stored | the shared secret | both | changes the webhook with the stored secret |
| the webhook is changed | the repository's own | both | asks for a ping and verifies it |
| a signed delivery is verified and the row is marked | the repository's own | the repository's own, once every repository is moved (FR-254) | changes nothing |

### Onboarding from the first Step 4 release

Until the first Step 4 release, onboarding is as it is today, with the person's token from Step 3 (FR-034, FR-206, FR-207 of the first spec). From that release on, a newly onboarded repository starts where the reconciliation job below leaves an existing one.

- **FR-273**: From the first Step 4 release, on an install set to `true` in FR-445, onboarding commits the workflow that asks for the identity token (FR-245, FR-246, FR-282).
- **FR-274**: On such a host, onboarding sets no repository secret `LORE_INGEST_TOKEN`.
- **FR-275**: From the first Step 4 release, onboarding creates the repository's webhook with that repository's own signing secret (FR-110).
- **FR-276**: On such a host, onboarding records the repository's row as moved for its webhook and its workflow (FR-248, FR-249).
- **FR-277**: On an install set to `false` in FR-445, onboarding sets the repository secret `LORE_INGEST_TOKEN` to the repository's stored CI token of FR-078.
- **FR-306**: On such a host, onboarding records the repository's row as moved for its webhook (FR-248) and as holding its own token in place of the shared one (FR-308).
- **FR-307**: Onboarding a repository again leaves those records as they are and replaces nothing that is already the repository's own.
- **FR-278**: From the first Step 4 release, onboarding never sets a repository secret to the shared admin token's value.

### Moving existing repositories

Nothing in lore-api or the stations service opens the pull request that changes an installed workflow today: lore-api writes the workflow at onboarding (`libs/shared/src/work/onboard/onboard-scaffold.ts`, from the template in `libs/shared/src/work/ingest-workflow.ts`) and only the web UI opens a later fix. The move is a stations job this spec introduces.

The job does not delete a repository's `LORE_INGEST_TOKEN` secret as part of the move. That secret's value is the shared admin token, which stops working for everyone when it is withdrawn, so a secret left behind opens nothing. Proving that every workflow of every repository has stopped reading it is not needed to make it so: a repository whose own workflow still uses the shared token shows up as a recorded use (FR-120, FR-326), and that is what holds the withdrawal back.

- **FR-241**: A reconciliation job of the stations service visits every onboarded repository.
- **FR-242**: The job starts only once the first Step 4 release is the release a rollback returns to.
- **FR-243**: A run of the job over a repository it has already moved changes nothing.
- **FR-244**: The job sets the repository's webhook on GitHub to that repository's own signing secret, through `ensureLoreWebhook`.
- **FR-245**: The job opens a pull request that changes the installed workflow (`.github/workflows/lore-ingest.yml`) to ask for the identity token (FR-316 for the `ingest` job, FR-268 for the `graph` job).
- **FR-289**: Where the repository has the trace-impact workflow Lore installs (`.github/workflows/lore-trace-impact.yml`), the same pull request changes it to ask for the identity token.
- **FR-246**: The workflow of that pull request does not read `LORE_INGEST_TOKEN`.
- **FR-281**: In that workflow the `ingest` job is granted `id-token: write` and `contents: read`, and no other permission.
- **FR-282**: In that workflow the `graph` job is granted `id-token: write` and `contents: read`, and no other permission.
- **FR-326**: The row of FR-120 names the repository the request concerns, by its GitHub numeric id, where the request names one.
- **FR-248**: The repository's row in `lore.repos` records that its webhook is moved.
- **FR-249**: The repository's row records that its workflow is moved once the pull request of FR-245 is merged.
- **FR-308**: On a host of FR-253, the repository's row records that its secret holds the repository's own token.
- **FR-251**: A step that fails for a repository is tried again on the job's next run.
- **FR-252**: A step that fails for one repository does not stop the job for the others.
- **FR-253**: On an install set to `false` in FR-445, the job replaces the repository secret `LORE_INGEST_TOKEN` with the repository's stored CI token of FR-078 and opens no identity-token pull request.
- **FR-254**: lore-api refuses deliveries signed with the shared webhook secret (FR-113) only when every onboarded repository's row records its webhook moved.
- **FR-255**: lore-api's report that the shared admin token is ready for withdrawal depends on the window of FR-124 alone, and on no repository's move state.
- **FR-486**: After the withdrawal (FR-121), on an install set to `true` in FR-445, the job deletes each repository's `LORE_INGEST_TOKEN` secret, which by then opens nothing.
- **FR-487**: A deletion of that secret that fails is tried again on the job's next run and holds nothing else back.
- **FR-363**: lore-api serves a report of the move to an administrator, at a route this spec introduces (`GET /api/admin/repository-moves`), with one row for each onboarded repository.
- **FR-364**: A row is keyed by the repository's GitHub numeric id and carries its current name.
- **FR-365**: A row carries the states of FR-248 and FR-249, and of FR-308 on a host of FR-253.
- **FR-367**: A row carries the time of the repository's last request made with the shared token.
- **FR-368**: A row carries the error of the last step that failed for the repository.
- **FR-376**: The install guide's withdrawal step (FR-163) points the operator to that report.

### The shared admin token

- **FR-120**: Every request lore-api accepts with the token it reads from its environment (`LORE_INGEST_TOKEN`) writes a row to a table of its own, which this spec introduces, with the time and the caller as far as it is known.
- **FR-406**: A request made with that token whose row cannot be written is refused, so no use goes unrecorded.
- **FR-407**: The migration of the first Step 4 release stores the time it ran, which is the start of the observation window.
- **FR-124**: lore-api reports the shared admin token ready for withdrawal only when 30 consecutive days have passed since the later of that start and the last recorded use.
- **FR-125**: A recorded use starts the 30 days again whoever made it, a caller the row cannot name included.
- **FR-126**: When the first Step 4 release is installed again after a rollback to a release that records no use, the start of the window is set to the time of that install.
- **FR-163**: The install guide's withdrawal step tells the operator to withdraw the token only when lore-api reports it ready.
- **FR-121**: After the withdrawal, lore-api accepts no token from its environment.
- **FR-122**: No workload of a rendered install holds the shared admin token.
- **FR-123**: An operator mints an emergency token with a command inside the cluster.
- **FR-127**: An emergency token names the operator who minted it.
- **FR-128**: An emergency token carries an expiry.
- **FR-378**: An emergency token minted with no lifetime named expires four hours after its minting.
- **FR-195**: The command that mints an emergency token mints none without an expiry.
- **FR-377**: The command that mints an emergency token refuses a lifetime longer than 24 hours.
- **FR-129**: The minting of an emergency token is written to the audit log.

### What operators can see

- **FR-132**: lore-api exports a count of refused identity tokens.
- **FR-134**: lore-api exports a count of uses of the shared admin token by caller.
- **FR-135**: lore-api exports the number of repositories still on the shared webhook secret.
- **FR-256**: lore-api exports the number of repositories whose workflow is not yet moved.

## Success Criteria

- **SC-008**: A workflow's credential for one repository is refused for another, and so is an agent's.
- **SC-015**: No GitHub token issued to a run reaches a second repository, and after the run ends or is cancelled each is revoked at GitHub or expired, with a failed revocation, a restart of lore-api and a floor that could not be reached for a while included.
- **SC-009**: A pull request from an author without `write` starts nothing by default and never yields an approval.
- **SC-010**: Nothing in a rendered install holds the shared admin token.
- **SC-012**: An agent's credential is refused on every organisation-wide route.
- **SC-013**: The shared admin token is not reported ready for withdrawal while any caller has used it in the last 30 days.
- **SC-017**: After the reconciliation job has finished, every onboarded repository's webhook has its own secret, and after the withdrawal no `LORE_INGEST_TOKEN` secret left in a repository opens anything in Lore.
- **SC-019**: A workflow moved to the identity token completes an ingest run that makes many requests and lasts longer than one identity token.
- **SC-020**: A repository onboarded after the first Step 4 release never holds the shared admin token and its webhook never uses the shared secret.
- **SC-024**: A repository whose own workflow still reads `LORE_INGEST_TOKEN` goes on working, each of its uses is recorded against that repository, and the shared admin token is not reported ready while it does.
- **SC-025**: A repository's stored CI token is refused on every route outside its list, for its own repository too.
- **SC-027**: The stations token is refused on a route no stations job calls, and no workload other than the stations service and its scheduled jobs holds it.
- **SC-028**: After a developer signs in from the terminal or the editor, no copy of the shared admin token is left in their git config or editor settings, and their calls reach Lore as themselves.
- **SC-029**: An operator can read, for each repository, whether its webhook and its workflows are moved, when it last used the shared token and the last error of its move.
- **SC-030**: A webhook move stopped at any step and run again ends with the repository on its own secret and no delivery refused.
- **SC-033**: From the first Step 4 release, no signed-in member can read the shared admin token on the settings page or through the settings route.
- **SC-034**: A developer signs in from the terminal and from the editor against an install on a GitHub host without the device flow, and no session is left in their editor settings, git config or environment.

## Assumptions

- Steps 1 to 3 of the first spec are in place: repositories and people are recorded by GitHub numeric id, and a person's level is asked from GitHub.
- Step 4 takes two releases, and repositories are moved between them.
- An agent that holds no GitHub token at all is a later option and not part of this spec; that agents keep an installation token for one repository is FR-184.
- The gateway token's encoding, the rotation of the floor's key and what a long visit does at expiry are a spec of their own, written before this step starts.
- A workflow Lore did not install cannot be changed by Lore. While such a workflow uses the shared admin token, its uses are recorded and the token is not reported ready for withdrawal; when it is withdrawn anyway, that workflow's calls to Lore are refused until its owners change it.
- An emergency token lasts 4 hours by default and 24 hours at most (FR-128, FR-377). Proposed 2026-11-19; the owner has not confirmed the numbers.
- The shared admin token is watched for 30 days without a use before it is reported ready for withdrawal (FR-124), and a kept key set is used for one hour at most (FR-155). Proposed 2026-11-19; the owner has not confirmed the numbers.
- Local clients sign in by Lore's own pairing (FR-416 to FR-425), not GitHub's device flow. Proposed 2026-11-19; the owner has not confirmed it. A pairing's session works only while the same person has a session with a stored GitHub token, that is, while they are signed in on the web.
- On an install set to `false` in FR-445, a repository's stored CI token carries no ref, so lore-api cannot tell which branch a workflow ran on and the default-branch rule for ingest (FR-157) does not hold there (FR-314). Such a token still does nothing outside its own repository's ingest and check routes, which is less than the shared secret it replaces does today. Proposed 2026-11-19, awaiting the owner.
- Whether a GitHub host's identity tokens carry the repository id claims is set once for an install (FR-445) and cannot change after a repository is onboarded (FR-485). Moving an install from one mode to the other is not part of this spec.
- The stations service's calls to lore-api were listed by searching `apps/stations` for lore-api paths. A call made only through a shared library function may be missing from FR-345; the test of FR-347 is what finds it.

## Open Questions

- **GitHub Enterprise Server** — Choices: use the Actions identity token there, or fall back to the stored per-repository CI token. Whether the identity token carries the claims has to be confirmed on a real server of the versions installers run.
