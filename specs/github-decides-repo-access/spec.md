# Feature Specification: GitHub decides who can open a repository

| Field     | Value                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| Feature   | GitHub decides who can open a repository                                                        |
| Branch    | github-decides-repo-access                                                                      |
| Status    | Draft                                                                                           |
| Created   | 2026-11-19                                                                                      |
| Owner     | Platform Engineering                                                                            |
| Builds on | [ADR-054](../../adrs/ADR-054-github-decides-who-can-open-a-repository.md), [ADR-053](../../adrs/ADR-053-lore-api-is-the-identity-provider.md) |

Lore answers "may this caller do this to this repository" by asking GitHub for people, and by giving every caller that is not a person a credential that can do its one job and nothing else. This spec states what [ADR-054](../../adrs/ADR-054-github-decides-who-can-open-a-repository.md) decides as requirements a test can prove, in the four steps the ADR builds them in.

## Problem Statement

Lore acts on GitHub with a GitHub App that can read and write every repository it is installed on, and Lore alone decides who may ask it to. A person's access is a list of repository names taken once at sign-in and never refreshed. Every session carries the `admin` scope. Most callers that are not people share one token with every scope, no expiry and no owner. ADR-054 has the full account and the reasons for each choice below; this spec repeats neither.

## User Scenarios

### User Story 1 - A person sees and changes only what GitHub lets them (Priority: P1)

A member of the organisation signs in and sees the repositories GitHub says they can access. What they change in a repository through Lore, GitHub checks against their own permission, and when their access to a repository is removed on GitHub, Lore follows within minutes.

**Why this priority**: it replaces the list taken once at sign-in, which is the widest gap.

**Independent Test**: sign in as a person with `read` on one repository and none on another, and try a read and a write on each.

### User Story 2 - A person who leaves the organisation loses Lore (Priority: P1)

An owner removes a member from the GitHub organisation. Within five minutes that person's sessions have ended, and a token they minted earlier is refused when it is next used.

**Why this priority**: a session lasts up to 30 days today and a minted token for ever.

**Independent Test**: remove a signed-in member who holds a minted token, wait five minutes, and use the session and the token.

### User Story 3 - One leaked machine credential opens one repository (Priority: P2)

A repository's CI, an agent run and a repository's webhook each hold a credential that works for that repository only. The token that opens the whole install is gone.

**Why this priority**: it depends on the first two stories and changes the workflows Lore installs.

**Independent Test**: use one repository's CI credential and one run's gateway credential against another repository.

## Requirements

A level is GitHub's permission on a repository: `read`, `write` or `admin`. An organisation-wide route is one that belongs to no repository (agent definitions, tokens, organisation settings, pools, the audit log, pack sync). "The upgrade" is the release that switches on Step 3.

### Step 1: the guard

Step 1 is the repository guard: every lore-api route that names a repository asks whether the caller can open it. Its requirements are FR-9.20 and FR-9.21 of [`specs/4-ux-repo-onboarding/spec.md`](../4-ux-repo-onboarding/spec.md), and this spec adds none for it. Work on Step 2 does not start until Step 1 is merged.

### Step 2: levels

- **FR-001**: Every lore-api route that names a repository, in its path as `{owner}/{repo}` or in its payload, declares the level it needs beside its `bearerScope`.
- **FR-164**: A test lists every route lore-api registers that names a repository and fails when one declares no level.
- **FR-165**: The same test holds the list of `admin` routes below (FR-004, FR-166 to FR-171, FR-196 to FR-203) and fails when a route outside it declares `admin` or a route in it declares less.
- **FR-007**: The repository guard (`registerRepoGuard`) answers a person `403` when the level GitHub reports for them on the repository is below the level the route declares.
- **FR-008**: In Step 2 the guard learns a person's level by asking GitHub, as the App, about that person.
- **FR-009**: From Step 3 the guard learns a person's level by asking GitHub with that person's own token.
- **FR-002**: A route that names a repository and changes nothing needs `read`.
- **FR-003**: A route that names a repository and changes anything, in Lore or on GitHub, needs `write`, unless it is in the `admin` list below.
- **FR-004**: `POST /api/onboard`, for a first onboarding and for a re-onboarding, needs `admin` on the repository in its payload.
- **FR-166**: `PUT /api/repos/{owner}/{repo}/settings`, which carries the auto-merge setting, needs `admin`.
- **FR-167**: `POST /api/repos/{owner}/{repo}/webhook/ensure` needs `admin`, because it creates the repository's webhook.
- **FR-168**: `POST /api/repos/{owner}/{repo}/utopia/setup` needs `admin`.
- **FR-169**: `POST /api/repos/{owner}/{repo}/utopia/backfill` needs `admin`.
- **FR-170**: `POST /api/repos/{owner}/{repo}/utopia/reset` needs `admin`.
- **FR-171**: `POST /api/repos/{owner}/{repo}/utopia/commits` needs `admin`.
- **FR-196**: `POST /api/repos/{owner}/{repo}/utopia/memory` needs `admin`.
- **FR-197**: `POST /api/repos/{owner}/{repo}/utopia/releases` needs `admin`.
- **FR-198**: `POST /api/repos/{owner}/{repo}/utopia/tracker` needs `admin`.
- **FR-199**: `PUT /api/repos/{owner}/{repo}/loops/{key}` needs `admin`.
- **FR-200**: `DELETE /api/repos/{owner}/{repo}/loops/{key}/pause` needs `admin`.
- **FR-201**: `POST /api/repos/{owner}/{repo}/agent-definitions` needs `admin`.
- **FR-202**: `PUT /api/repos/{owner}/{repo}/agent-definitions/{name}` needs `admin`.
- **FR-203**: `DELETE /api/repos/{owner}/{repo}/agent-definitions/{name}` needs `admin`.
- **FR-204**: The test of FR-164 builds its list from the routes lore-api registers, so a route made by a factory (`utopiaWalkRoute`, the loops routes) is in it under its own path.
- **FR-005**: A `write` or `admin` route asks GitHub at the time of the request and never answers from a cached level.
- **FR-006**: lore-api has no route that returns a webhook signing secret: `GET /api/repos/{owner}/{repo}/webhook/secret` is removed.

### Step 3: user access tokens

#### Sign-in and stored tokens

- **FR-010**: `/api/auth/login` and `/api/auth/callback` sign a person in through the GitHub App's web authorization flow.
- **FR-026**: After the upgrade, a sign-in through the OAuth App creates no session.
- **FR-011**: A sign-in whose token answer from GitHub carries no expiry is refused and creates no session.
- **FR-028**: A sign-in whose token answer from GitHub carries no refresh token is refused and creates no session.
- **FR-012**: Sign-in admits only a person GitHub reports as an active member of the configured organisation.
- **FR-013**: lore-api stores the person's access token and refresh token encrypted with AES-256-GCM in a table keyed by the session's row in `pipeline.api_tokens`.
- **FR-025**: The key that encrypts the stored tokens is read from a Secret that holds nothing else.
- **FR-014**: Two refreshes of one session at once leave exactly one valid token pair.
- **FR-022**: A sign-out that arrives while a refresh of the same session is in flight leaves no stored token for that session.
- **FR-023**: A revocation event that arrives while a refresh of that person's session is in flight leaves no stored token for that session.
- **FR-015**: A session marked ended is never refreshed.
- **FR-016**: A refresh whose outcome is unknown ends the session.
- **FR-017**: Sign-out (`/api/auth/logout`) deletes the session's stored tokens.
- **FR-018**: A `github_app_authorization` revocation event with a valid signature deletes the stored tokens of that person.
- **FR-027**: A `github_app_authorization` revocation event with a valid signature ends every session of that person.
- **FR-019**: An event sent to the App's webhook is verified, before it is read, with a signing secret that is no repository's webhook secret.
- **FR-024**: An event sent to the App's webhook with a bad signature changes nothing.
- **FR-020**: lore-api accepts two App webhook secrets at once while one is being replaced.
- **FR-021**: A scheduled sweep deletes the stored tokens of every session that has expired.

#### What a person sees and does

- **FR-030**: `GET /api/repos` shows a person only repositories returned by `GET /user/installations/{installation_id}/repositories` asked with that person's token.
- **FR-172**: `GET /api/repos/available`, the list of repositories available to onboard, shows a person only repositories of that same answer.
- **FR-173**: `GET /api/search-context` shows a person only results that belong to a repository of that same answer.
- **FR-205**: `GET /api/memory-search` shows a person only results that belong to a repository of that same answer.
- **FR-174**: `GET /api/inbox` shows a person only items of a repository of that same answer.
- **FR-038**: lore-api reads that list to its last page, with no cap on the number of repositories.
- **FR-039**: A refresh replaces the kept list only when every page of it was read.
- **FR-140**: A refresh in which a page fails leaves the previous list in place and does not count as a fresh answer for FR-033.
- **FR-031**: Every read of what Lore has stored about a repository is refused for a person whose list does not contain that repository.
- **FR-032**: A person's repository list is kept per session for at most five minutes.
- **FR-033**: When the list is older than five minutes and GitHub gives no fresh answer, reads are refused and are not served from the old list.
- **FR-034**: When a person onboards a repository through `POST /api/onboard`, lore-api sets the repository secret `LORE_INGEST_TOKEN` on GitHub with that person's token.
- **FR-206**: In the same onboarding, lore-api sets the repository variable `LORE_INGEST_URL` on GitHub with that person's token.
- **FR-207**: In the same onboarding, lore-api creates the repository's webhook on GitHub with that person's token.
- **FR-175**: When a person opens a pull request through lore-api at the moment of the request, it is opened on GitHub with that person's token.
- **FR-176**: When a person merges a pull request through lore-api, it is merged on GitHub with that person's token.
- **FR-177**: When a person files an issue through lore-api, it is filed on GitHub with that person's token.
- **FR-035**: On a repository route, GitHub's answer decides for a person, whatever scope their session carries.
- **FR-036**: A signed-in member can use the organisation-wide routes.
- **FR-037**: The web UI's workload holds no GitHub credential.
- **FR-141**: What the web UI reads from GitHub today with the App's key (`apps/web-ui/src/lib/github.ts`: a file, the README, a repository's details, a pull request's details) it asks lore-api for. lore-api has no routes for these reads today; Step 3 introduces them.
- **FR-216**: lore-api makes those reads on GitHub with the signed-in person's token.

#### Membership and minted tokens

- **FR-040**: lore-api asks GitHub whether the person is still an active member of the organisation whenever it refreshes their repository list.
- **FR-041**: A person GitHub no longer reports as an active member has every session ended.
- **FR-042**: When the membership answer is older than five minutes and GitHub gives no fresh one, the organisation-wide routes are refused.
- **FR-043**: A membership question that GitHub refuses for want of permission admits nobody.
- **FR-142**: A membership question that GitHub refuses for want of permission is answered to the person as a fault of the install, with an error other than the one a non-member gets.
- **FR-044**: A token minted by a person through `POST /api/tokens` records that person's GitHub numeric id in `pipeline.api_tokens`.
- **FR-045**: When a minted token is used and the last membership answer for its maker is older than five minutes, lore-api asks GitHub, as the App, before it serves the request.
- **FR-046**: A request made with a token whose maker is no longer an active member is refused.
- **FR-048**: When lore-api finds that a token's maker is no longer an active member, it revokes every token that person minted.
- **FR-049**: When lore-api finds that a token's maker is no longer an active member, it ends every session of that person.
- **FR-047**: The stations token cannot be minted through `POST /api/tokens`.
- **FR-178**: An operator's emergency token cannot be minted through `POST /api/tokens`.

#### Repository identity

- **FR-050**: Access and credentials are recorded against a repository's GitHub numeric id, so a repository that takes another's name does not take its access.
- **FR-051**: The migration fills each repository row's id by asking GitHub through the installation.
- **FR-052**: A repository row whose id cannot be found is refused to every caller until an operator resolves it.
- **FR-053**: A repository row whose id equals another row's is refused to every caller until an operator resolves it.

#### Switching the new mode on

- **FR-143**: lore-api switches to the new mode only after GitHub has answered an active-membership question asked with a user token of the App.
- **FR-144**: Until that answer, lore-api ends no session and revokes no minted token.
- **FR-145**: Until that answer, lore-api goes on serving in the old mode.
- **FR-064**: At start, lore-api refuses to run in the new mode when a setting the values file must carry for it is missing.
- **FR-065**: lore-api reads the App's permissions through GitHub's API (`GET /app`) and writes a warning to its log for each required permission that is missing.
- **FR-208**: lore-api reads the App's webhook configuration through GitHub's API (`GET /app/hook/config`) and writes a warning to its log when no webhook address is set.
- **FR-146**: The settings page shows each App permission or webhook setting that lore-api found missing.
- **FR-066**: The install guide (`docs/github-setup.md`) carries a checklist of the App's settings that lore-api cannot read back.
- **FR-217**: The checklist names the callback URL.
- **FR-179**: The checklist names the client secret.
- **FR-180**: The checklist names the device flow.
- **FR-181**: The checklist names expiring user tokens.
- **FR-182**: The checklist names the App's webhook address.
- **FR-209**: The checklist names the App webhook's signing secret.
- **FR-183**: The checklist names the organisation permission Members (read) and its approval by an owner.

#### The upgrade and the rollback

- **FR-060**: The upgrade ends every session that existed before it.
- **FR-061**: The upgrade revokes every token minted before it.
- **FR-062**: A minted token carries a mark of the kind of release that made it.
- **FR-063**: The rollback step runs before the older release serves a request.
- **FR-067**: The rollback step ends every session.
- **FR-068**: The rollback step revokes every token minted since the upgrade.
- **FR-069**: The rollback step deletes every stored GitHub token.
- **FR-147**: The release of the upgrade keeps the OAuth App's client id and secret in the values file.
- **FR-148**: After a rollback from the release of the upgrade, the older release signs people in through the OAuth App.
- **FR-149**: The release after the upgrade reads no OAuth App setting.
- **FR-150**: The install guide of the release after the upgrade tells the installer to delete the OAuth App.

### Step 4: callers that are not people

#### A repository's CI

- **FR-070**: lore-api accepts a GitHub Actions identity token for ingest only when its issuer is exactly the configured GitHub host's.
- **FR-151**: An identity token is accepted only when its signature matches a key of the key set that issuer publishes.
- **FR-152**: lore-api fetches the key set from the configured issuer and from nowhere else.
- **FR-153**: An identity token signed with a key id lore-api does not hold triggers one fetch of the key set.
- **FR-218**: An identity token whose key id is still unknown after that fetch is refused.
- **FR-154**: An identity token is refused when its key cannot be confirmed because the key set could not be fetched.
- **FR-155**: A kept key set has a maximum age, after which lore-api fetches it again before it accepts a token.
- **FR-071**: An identity token whose audience is not this install's own address is refused.
- **FR-072**: An identity token outside its validity period (`iat`, `nbf`, `exp`) is refused.
- **FR-073**: An identity token's `jti` is recorded in the database under a unique key before the request is handled and until the token expires, so the same token sent twice, to one replica or to two at once, is accepted once.
- **FR-074**: An identity token is accepted only when its `repository_id` and `repository_owner_id` match an onboarded repository.
- **FR-156**: An accepted identity token allows ingest for the repository it names and for no other.
- **FR-075**: An identity token is accepted only when its `workflow_ref` names the workflow Lore installed.
- **FR-157**: An identity token from a ref other than the repository's default branch is refused.
- **FR-076**: An identity token from a pull request of a fork is refused.
- **FR-077**: lore-api issues no longer-lived credential in exchange for an identity token.
- **FR-078**: Where the identity token cannot be used, a repository's CI holds a stored token that carries only the ingest scopes.
- **FR-158**: A repository's stored ingest token is refused for any other repository.
- **FR-079**: The first Step 4 release accepts an ingest request with either the stored token or the identity token.
- **FR-159**: After a rollback to the first Step 4 release, a workflow already moved to the identity token still ingests.

#### Agent runs

- **FR-080**: A run started by a person records that person's GitHub numeric id.
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
- **FR-190**: After a token is minted, lore-api reads the run's state again, and when the run has ended or been cancelled meanwhile it revokes the token and does not return it.
- **FR-191**: A token minted while the run's cancellation was in progress is among the tokens the cancellation revokes.
- **FR-083**: When a run ends or is cancelled, lore-api revokes every installation token it minted for it.
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

#### Runs Lore starts itself

- **FR-090**: A pull request from an author without `write` starts a review only when the repository's setting for it is on.
- **FR-094**: That setting is off by default.
- **FR-091**: The GitHub token of a run started by an event whose author has no `write` is the `read` token of FR-211.
- **FR-095**: The gateway offers such a run no tool that writes in Lore.
- **FR-092**: The findings of such a run are posted as a comment, never as an approving review or a passing check.
- **FR-093**: A scheduled job authenticates with the stations token.

#### Stations, laptops and the editor

- **FR-100**: The stations service and its scheduled jobs authenticate with a named system token that carries only the scopes their jobs use.
- **FR-101**: The stations token can be replaced without changing any other credential.
- **FR-102**: The local MCP server signs a person in with the App's device flow and holds a session for that person.
- **FR-103**: The VS Code extension signs a person in with the App's device flow and holds a session for that person.

#### Webhook secrets

- **FR-110**: Each repository's webhook has a signing secret of its own, in place of the one `LORE_WEBHOOK_SECRET` for all.
- **FR-115**: A repository's webhook secret is stored encrypted, against the repository's GitHub numeric id.
- **FR-111**: The first Step 4 release accepts a delivery signed with either the shared secret or the repository's own.
- **FR-112**: After a rollback to the first Step 4 release, a delivery from a repository already moved to its own secret is still accepted.
- **FR-113**: Once no webhook uses the shared secret, a delivery signed with it is refused.

#### The shared admin token

- **FR-120**: lore-api logs every use of the token it reads from its environment (`LORE_INGEST_TOKEN`), with the caller.
- **FR-124**: lore-api reports the shared admin token ready for withdrawal only when that log covers one complete release with no use.
- **FR-125**: A use by a caller the log cannot name keeps the token reported as not ready.
- **FR-126**: A part of that release without the log keeps the token reported as not ready.
- **FR-163**: The install guide's withdrawal step tells the operator to withdraw the token only when lore-api reports it ready.
- **FR-121**: After the withdrawal, lore-api accepts no token from its environment.
- **FR-122**: No workload of a rendered install holds the shared admin token.
- **FR-123**: An operator mints an emergency token with a command inside the cluster.
- **FR-127**: An emergency token names the operator who minted it.
- **FR-128**: An emergency token carries an expiry.
- **FR-195**: The command that mints an emergency token mints none without an expiry.
- **FR-129**: The minting of an emergency token is written to the audit log.

#### What operators can see

- **FR-130**: lore-api exports a count of refused requests by reason.
- **FR-131**: lore-api exports a count of failed token refreshes.
- **FR-132**: lore-api exports a count of refused identity tokens.
- **FR-133**: lore-api exports a count of failed revocation events.
- **FR-134**: lore-api exports a count of uses of the shared admin token by caller.
- **FR-135**: lore-api exports the number of repositories still on the shared webhook secret.

## Success Criteria

- **SC-001**: For every repository route, a person one level below what the route needs is refused.
- **SC-014**: No repository route is registered without a level, and the `admin` routes are exactly the ones this spec lists.
- **SC-002**: A person without `admin` on a repository cannot onboard it.
- **SC-003**: A removed grant refuses the person's next write and, after five minutes at most, every read.
- **SC-004**: A member who is no repository's administrator still opens the organisation-wide pages, and a non-member cannot sign in.
- **SC-005**: A person removed from the organisation has their sessions ended within five minutes, and a token they minted is refused at its next use, including one left unused since before they were removed.
- **SC-006**: After the upgrade, no session and no minted token from before it is accepted.
- **SC-007**: After a rollback, no session, no token minted since the upgrade and no stored GitHub token remains, and people sign in through the OAuth App again.
- **SC-008**: A workflow's credential for one repository is refused for another, and so is an agent's.
- **SC-015**: No GitHub token issued to a run reaches a second repository, and none outlives the run's cancellation.
- **SC-009**: A pull request from an author without `write` starts nothing by default and never yields an approval.
- **SC-010**: Nothing in a rendered install holds the shared admin token.
- **SC-011**: A person who can access more than a thousand repositories of the installation sees all of them.
- **SC-012**: An agent's credential is refused on every organisation-wide route.
- **SC-013**: The shared admin token is not reported ready for withdrawal while any caller still uses it.

## Assumptions

- Step 1 (FR-9.20 and FR-9.21 of `specs/4-ux-repo-onboarding/spec.md`) is merged before any step here.
- Before Step 3 is built, it is confirmed on a real installation that a user token of the App can set a repository secret and a repository variable and create a webhook. If it cannot, work on Step 3 stops and ADR-054 is amended; this spec names no other credential for those calls.
- Steps 2 and 3 can ship without Step 4; Step 4 takes two releases.
- An existing install changes its GitHub App's settings once, and an owner of the organisation approves the permission Members (read), before the upgrade. The new mode does not switch on without it (FR-143).
- At the upgrade everyone signs in again and every token minted through Lore is minted again. Decided 2026-11-19.
- Five minutes of staleness on reads is accepted. Decided 2026-11-19.
- An agent that holds no GitHub token at all is a later option and not part of this spec; that agents keep an installation token for one repository is FR-184.
- Every signed-in member keeps the organisation-wide routes for now. Decided 2026-11-19.

## Open Questions

- **GitHub Enterprise Server** — Choices: use the device flow and the Actions identity token there, or fall back to the stored per-repository token and a browser sign-in. Both have to be confirmed on a real server of the versions installers run.
- **A session whose refresh fails** — Choices: the session ends, or it falls back to read-only until the person signs in again.
- **The encryption key of FR-025** — Choices: generated by the chart like the other tokens, or required from the installer.
- **The longest life of an emergency token (FR-128)** — ADR-054 says "within hours". Choices: one fixed maximum, or a maximum the installer sets.
- **The maximum age of a kept key set (FR-155)** — Choices: what the issuer's own cache headers say, or one fixed age.
- **When to narrow the organisation-wide routes** — Choices: owners of the GitHub organisation only, or also a named GitHub team.
