# Feature Specification: GitHub decides who can open a repository

| Field     | Value                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| Feature   | GitHub decides who can open a repository                                                        |
| Branch    | github-decides-repo-access                                                                      |
| Status    | Draft                                                                                           |
| Created   | 2026-11-19                                                                                      |
| Owner     | Platform Engineering                                                                            |
| Builds on | [ADR-054](../../adrs/ADR-054-github-decides-who-can-open-a-repository.md), [ADR-053](../../adrs/ADR-053-lore-api-is-the-identity-provider.md) |

Lore answers "may this person do this to this repository" by asking GitHub. This spec states what [ADR-054](../../adrs/ADR-054-github-decides-who-can-open-a-repository.md) decides for people, as requirements a test can prove, in the first three steps the ADR builds them in. The fourth step, the callers that are not people, is [`specs/machine-callers-own-credentials/spec.md`](../machine-callers-own-credentials/spec.md). Requirement numbers are unique across the two specs.

## Problem Statement

Lore acts on GitHub with a GitHub App that can read and write every repository it is installed on, and Lore alone decides who may ask it to. A person's access is a list of repository names taken once at sign-in and never refreshed. Every session carries the `admin` scope. Most callers that are not people share one token with every scope, no expiry and no owner. ADR-054 has the full account and the reasons for each choice below; this spec repeats neither.

## User Scenarios

### User Story 1 - A person sees and changes only what GitHub lets them (Priority: P1)

A member of the organisation signs in and sees the repositories GitHub says they can access. What they change in a repository through Lore, GitHub checks against their own permission, and when their access to a repository is removed on GitHub, Lore follows within minutes.

**Why this priority**: it replaces the list taken once at sign-in, which is the widest gap.

**Independent Test**: sign in as a person with `read` on one repository and none on another, and try a read and a write on each.

### User Story 2 - A person who leaves the organisation loses Lore (Priority: P1)

An owner removes a member from the GitHub organisation. No request of that person is served on a membership answer older than five minutes: their next request after that finds them removed, is refused, and ends all their sessions and revokes the tokens they minted. A session or a token nobody uses is ended at its next use or by its own expiry, and is never honoured.

**Why this priority**: a session lasts up to 30 days today and a minted token for ever.

**Independent Test**: remove a signed-in member who holds a minted token and a second, unused session; wait five minutes; use the first session, then the token, then the unused session.

## Requirements

A level is GitHub's permission on a repository: `read`, `write` or `admin`. An organisation-wide route is one that belongs to no repository (agent definitions, tokens, organisation settings, pools, the audit log, pack sync). "The upgrade" is the release that switches on Step 3. A route concerns a repository when a repository is named in its path, its payload or its query, or is reached through a run, a task, a plan or another record the request names.

### Step 1: the guard

Step 1 is the repository guard: every lore-api route that names a repository in its path as `{owner}/{repo}` asks whether the caller can open it. Its requirements are FR-9.20 and FR-9.21 of [`specs/4-ux-repo-onboarding/spec.md`](../4-ux-repo-onboarding/spec.md), and this spec adds none for it. The guard of Step 1 reads path parameters only: a route that takes its repository from a query or a payload, or reaches it through a record, and a route whose answer spans repositories, are not covered by it. Covering them is Step 2's work (FR-001, FR-257 to FR-266). Work on Step 2 does not start until Step 1 is merged.

### Step 2: levels

- **FR-001**: Every lore-api route that concerns a repository declares the level it needs beside its `bearerScope`.
- **FR-257**: Every such route also declares how its repository is found: a path parameter, a payload field, a query parameter, or the record the request names.
- **FR-258**: The repository guard (`registerRepoGuard`) finds the repository the way the route declares, so a repository named in a query, in a payload or through a record is checked like one named in the path.
- **FR-259**: A route whose answer can hold rows of more than one repository declares that it spans repositories, in place of a way to find one.
- **FR-260**: A route that spans repositories returns a person only rows of repositories they can read.
- **FR-261**: `GET /api/chunks` asked with no `repo` returns a person only chunks of repositories they can read.
- **FR-262**: `GET /api/chunks?repo=` is refused for a person who cannot read that repository.
- **FR-263**: `GET /api/context?repo=` is refused for a person who cannot read that repository.
- **FR-264**: `GET /api/context-evals/documents?repo=` is refused for a person who cannot read that repository.
- **FR-265**: `GET /api/chunk-types?repo=` is refused for a person who cannot read that repository.
- **FR-266**: `GET /api/repo-status?repo=` is refused for a person who cannot read that repository.
- **FR-164**: A test lists every route lore-api registers and fails for one that reads or writes repository data and declares neither a level with a way to find its repository, nor that it spans repositories.
- **FR-165**: The same test holds the list of `admin` routes below (FR-004, FR-166 to FR-171, FR-196 to FR-203) and fails when a route outside it declares `admin` or a route in it declares less.
- **FR-007**: The repository guard (`registerRepoGuard`) answers a person `403` when the level GitHub reports for them on the repository is below the level the route declares.
- **FR-008**: In Step 2 the guard learns a person's level by asking GitHub, as the App, about that person.
- **FR-009**: From Step 3 the guard learns a person's level by asking GitHub with that person's own token.
- **FR-002**: A route that concerns a repository and changes nothing needs `read`.
- **FR-003**: A route that concerns a repository and changes anything, in Lore or on GitHub, needs `write`, unless it is in the `admin` list below.
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
- **FR-327**: Sign-in stores the person's GitHub numeric user id on the session's row in `pipeline.api_tokens` (the session columns of `deploy/chart/charts/ui-helm/migrations/0121_user_sessions.sql` hold a login and no id today).
- **FR-328**: `pipeline.api_tokens` has an index on that id.
- **FR-329**: Every operation on "every session of a person" (FR-018, FR-027, FR-237, FR-049) selects the sessions by that id, and never by login.
- **FR-330**: Every revocation of "every token a person minted" (FR-238, FR-048) selects the tokens by their maker's id of FR-044, and never by login.
- **FR-025**: The key that encrypts the stored tokens is read from a Secret that holds nothing else.
- **FR-220**: The row that holds a session's stored tokens also holds the access token's expiry.
- **FR-221**: The same row holds the refresh token's expiry.
- **FR-222**: Before lore-api calls GitHub with a person's token, it refreshes that token when the stored access-token expiry is less than five minutes away.
- **FR-223**: A refresh takes the lock on the session's token row before it calls GitHub's refresh endpoint.
- **FR-224**: A refresh replaces both stored tokens and both stored expiries in one transaction.
- **FR-225**: A request that finds the token row locked by a refresh waits for it and uses the token it stored, and starts no refresh of its own.
- **FR-014**: Two refreshes of one session at once leave exactly one valid token pair.
- **FR-226**: When GitHub answers a refresh that the refresh token is invalid, expired or revoked, the session is ended and the person signs in again.
- **FR-227**: When GitHub cannot be reached for a refresh, or answers it with a 5xx, the request is refused with the answer FR-033 gives when access cannot be checked.
- **FR-228**: After a refresh that failed in the way of FR-227, the session and its stored tokens are kept.
- **FR-229**: The next request of that session after such a failure tries the refresh again.
- **FR-022**: A sign-out that arrives while a refresh of the same session is in flight leaves no stored token for that session.
- **FR-023**: A revocation event that arrives while a refresh of that person's session is in flight leaves no stored token for that session.
- **FR-338**: Sign-out takes the lock on the session's token row that a refresh takes (FR-223).
- **FR-339**: The handling of a revocation event takes that same lock for each session of the person.
- **FR-340**: Under that lock, sign-out and revocation delete the stored tokens and mark the session ended in one transaction.
- **FR-341**: A refresh that gets the lock after a sign-out or a revocation finds the session ended and does not call GitHub.
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
- **FR-034**: Until the first Step 4 release (see the second spec), when a person onboards a repository through `POST /api/onboard`, lore-api sets the repository secret `LORE_INGEST_TOKEN` on GitHub with that person's token.
- **FR-206**: In the same onboarding, lore-api sets the repository variable `LORE_INGEST_URL` on GitHub with that person's token.
- **FR-207**: In the same onboarding, lore-api creates the repository's webhook on GitHub with that person's token; from the first Step 4 release its signing secret is the repository's own (FR-275 of the second spec).
- **FR-175**: When a person's session calls `POST /api/repos/{owner}/{repo}/pulls`, the pull request is opened on GitHub with that person's token.
- **FR-177**: When a person's session calls `POST /api/repos/{owner}/{repo}/issues`, the issue is filed on GitHub with that person's token.
- **FR-290**: Every change lore-api makes on GitHub while it handles a request of a person's session is made with that person's token, and never with the App's.
- **FR-291**: When a person's session calls `POST /api/repos/{owner}/{repo}/webhook/ensure`, the webhook is created or updated on GitHub with that person's token (today `ensureLoreWebhook` does it as the App).
- **FR-292**: When a person's session calls `POST /api/repos/{owner}/{repo}/branches`, the branch is created on GitHub with that person's token.
- **FR-293**: When a person's session calls `POST /api/repos/{owner}/{repo}/commit`, the file is committed on GitHub with that person's token.
- **FR-294**: When a person's session calls `POST /api/repos/{owner}/{repo}/issues/{number}/sub-issues`, the sub-issue is linked on GitHub with that person's token.
- **FR-295**: When a person's session calls `PATCH /api/repos/{owner}/{repo}/issues/{number}`, the issue is changed on GitHub with that person's token.
- **FR-296**: When a person onboards a repository through `POST /api/onboard`, the files that request commits to the repository are committed with that person's token.
- **FR-297**: The same routes, called with a credential that the second spec binds to one repository (a repository's stored CI token, a visit's token), make their change as the App, for that credential's one repository.
- **FR-337**: Until Step 4, the same routes called with a wide service token or a token a person minted make their change as the App, on the repository the request names, as they do today.

A token a person minted is not bound to a repository and is not that person's session, so FR-337 lets it change any repository through the App. That is the known gap of the decision that every member stays an administrator (FR-036), as it stands today; it is not a new grant, and Step 4 does not close it either.

- **FR-298**: The web UI opens the pull request that fixes an installed workflow through lore-api, at a route this spec introduces (`POST /api/repos/{owner}/{repo}/github/workflow-fix`), and no longer on GitHub with the App's key (`apps/web-ui/src/lib/github-workflow-pr.ts`).
- **FR-299**: lore-api opens that pull request on GitHub with the signed-in person's token.
- **FR-311**: A test fails when the handler of a request made with a person's session reaches a GitHub write through the App's client (`getOctokit` in `apps/lore-api/src/outbound/github-client.ts`, or the App-authenticated project).
- **FR-035**: On a repository route, GitHub's answer decides for a person, whatever scope their session carries.
- **FR-036**: A signed-in member can use the organisation-wide routes.
- **FR-037**: The web UI's workload holds no GitHub credential.
- **FR-141**: The web UI reads a repository file through lore-api, at a route this spec introduces (`GET /api/repos/{owner}/{repo}/github/file`), and no longer from GitHub with the App's key (`apps/web-ui/src/lib/github.ts`).
- **FR-216**: lore-api makes that file read on GitHub with the signed-in person's token.
- **FR-230**: The web UI reads a repository's README through lore-api, at a route this spec introduces (`GET /api/repos/{owner}/{repo}/github/readme`).
- **FR-231**: lore-api makes that README read on GitHub with the signed-in person's token.
- **FR-232**: The web UI reads a repository's details through lore-api, at a route this spec introduces (`GET /api/repos/{owner}/{repo}/github/details`).
- **FR-233**: lore-api makes that details read on GitHub with the signed-in person's token.
- **FR-234**: The web UI reads a pull request's details through lore-api, at a route this spec introduces (`GET /api/repos/{owner}/{repo}/github/pulls/{number}`).
- **FR-235**: lore-api makes that pull-request read on GitHub with the signed-in person's token.

#### Membership and minted tokens

- **FR-040**: lore-api asks GitHub whether the person is still an active member of the organisation whenever it refreshes their repository list.
- **FR-236**: No request of a person's session is served on a membership answer older than five minutes: lore-api asks GitHub first.
- **FR-041**: A request of a person GitHub no longer reports as an active member is refused.
- **FR-237**: That finding ends every session of the person, the ones not in use included.
- **FR-238**: That finding revokes every token the person minted.
- **FR-239**: A session left unused since before its person was removed is refused at its first request afterwards, however long it was idle; no scheduled job looks at it before then.
- **FR-042**: When the membership answer is older than five minutes and GitHub gives no fresh one, the request is refused.
- **FR-240**: A membership question GitHub does not answer ends no session and revokes no token.
- **FR-043**: A membership question that GitHub refuses for want of permission admits nobody.
- **FR-142**: A membership question that GitHub refuses for want of permission is answered to the person as a fault of the install, with an error other than the one a non-member gets.
- **FR-044**: A token minted by a person through `POST /api/tokens` records that person's GitHub numeric id in `pipeline.api_tokens`.
- **FR-045**: When a minted token is used and the last membership answer for its maker is older than five minutes, lore-api asks GitHub, as the App, before it serves the request.
- **FR-046**: A request made with a token whose maker is no longer an active member is refused.
- **FR-048**: When lore-api finds that a token's maker is no longer an active member, it revokes every token that person minted.
- **FR-049**: When lore-api finds that a token's maker is no longer an active member, it ends every session of that person.
- **FR-047**: The stations token cannot be minted through `POST /api/tokens`.
- **FR-178**: An operator's emergency token cannot be minted through `POST /api/tokens`.

#### Open live connections

The live socket (`apps/lore-api/src/work/assembly-line-station/live-socket.ts`) and its channels (`run-channel.ts`, `runs-channel.ts`, `plan-channel.ts`) look at the session once today, when a channel opens. A connection can stay open for hours, so it follows the same rules as a request.

- **FR-279**: When a session is ended, for a sign-out, a removal from the organisation, a revocation, the upgrade or the rollback, lore-api closes every live socket opened with it.
- **FR-280**: Before lore-api serves or accepts a frame on a live socket whose session was last checked more than five minutes ago, it checks the session again as it would for a request.
- **FR-283**: A live socket whose person is found to be no longer an active member is closed.
- **FR-284**: A channel on a repository its person can no longer read is closed.
- **FR-285**: When that check gets no answer from GitHub, the socket is closed with a reason that tells the client to connect again, and the session is kept (FR-240).
- **FR-286**: A plan collaboration token minted for a session is refused once that session has ended.
- **FR-300**: A live socket records the id of the session row that opened it.
- **FR-301**: A plan collaboration token (`apps/lore-api/src/work/plans/collab-tokens.ts`) records the id of the session it was minted for.
- **FR-302**: Ending a session sends a PostgreSQL notification that names the session's id.
- **FR-303**: Every lore-api replica listens for that notification and closes the live sockets it holds for that session.
- **FR-304**: A replica that holds an open plan collaboration connection of that session closes it; refusing the token at its next handshake is not enough.
- **FR-305**: A replica that missed the notification closes the socket at the check of FR-280, so no connection outlives its session by more than five minutes.

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

The release being replaced knows nothing of the new mode, so nothing in the database can make it stop writing sessions. The upgrade and a rollback from it are therefore done with lore-api stopped. The cost is a short outage of lore-api at that one upgrade, and at a rollback from it. lore-api already runs one replica while plans are live in it (ADR-047), so a rollout without an outage was not on offer.

- **FR-060**: The upgrade ends every session that existed before it.
- **FR-061**: The upgrade revokes every token minted before it.
- **FR-332**: For the release that introduces Step 3, the chart runs the upgrade's cleanup (FR-060, FR-061) in a job that first scales the lore-api Deployment to zero.
- **FR-333**: That job starts its cleanup only when no lore-api pod is running.
- **FR-334**: That job fails, and ends no session and revokes no token, when a lore-api pod is still running after its wait.
- **FR-335**: No lore-api pod of the incoming release starts before that job has finished.
- **FR-062**: A minted token carries a mark of the kind of release that made it.
- **FR-063**: The rollback step is a command of the upgrade's release that the operator runs before installing the older release; it scales the lore-api Deployment to zero and starts its cleanup only when no lore-api pod is running.
- **FR-336**: The rollback step fails, and changes nothing, when a lore-api pod is still running after its wait.
- **FR-343**: The install guide's rollback procedure installs the older release only after the rollback step has finished.
- **FR-067**: The rollback step ends every session.
- **FR-068**: The rollback step revokes every token minted since the upgrade.
- **FR-069**: The rollback step deletes every stored GitHub token.
- **FR-147**: The release of the upgrade keeps the OAuth App's client id and secret in the values file.
- **FR-148**: After a rollback from the release of the upgrade, the older release signs people in through the OAuth App.
- **FR-149**: The release after the upgrade reads no OAuth App setting.
- **FR-150**: The install guide of the release after the upgrade tells the installer to delete the OAuth App.

#### What operators can see

- **FR-130**: lore-api exports a count of refused requests by reason.
- **FR-131**: lore-api exports a count of failed token refreshes.
- **FR-133**: lore-api exports a count of failed revocation events.

### Step 4: callers that are not people

Step 4 gives every caller that is not a person a credential for its one job: a repository's CI, an agent run, the stations service, a laptop, a webhook. It has its own spec, [`specs/machine-callers-own-credentials/spec.md`](../machine-callers-own-credentials/spec.md), which builds on this one: it uses the repository's GitHub numeric id of FR-050, the person's id that sign-in stores (FR-327), and the person's level of FR-007. Steps 2 and 3 ship without it.

lore-api has no route that merges a pull request at a person's request today; the stations service merges. A route that is added for it falls under FR-290.

## Success Criteria

- **SC-001**: For every repository route, a person one level below what the route needs is refused.
- **SC-014**: No route that concerns a repository, however the repository is named, is registered without a level, and the `admin` routes are exactly the ones this spec lists.
- **SC-002**: A person without `admin` on a repository cannot onboard it.
- **SC-003**: A removed grant refuses the person's next write and, after five minutes at most, every read.
- **SC-004**: A member who is no repository's administrator still opens the organisation-wide pages, and a non-member cannot sign in.
- **SC-005**: Five minutes after a person is removed from the organisation, no request of theirs is served: their next request is refused and ends every session they have, a session left unused is refused at its first use, and a token they minted is refused at its next use, including one left unused since before they were removed.
- **SC-006**: After the upgrade, no session and no minted token from before it is accepted.
- **SC-007**: After a rollback, no session, no token minted since the upgrade and no stored GitHub token remains, and people sign in through the OAuth App again.
- **SC-026**: A sign-in that reaches a lore-api pod of the outgoing release during the upgrade leaves no session after it, because no such pod runs while the cleanup does.
- **SC-011**: A person who can access more than a thousand repositories of the installation sees all of them.
- **SC-016**: A session whose access token has expired keeps working without a new sign-in while its refresh token is valid, and ends when GitHub refuses the refresh token.
- **SC-018**: A person who cannot read a repository gets none of its rows from a route that takes the repository in a query or whose answer spans repositories.
- **SC-021**: A live connection of a person removed from the organisation is closed at its first frame more than five minutes after its last check, and at once when their session is ended.
- **SC-022**: A change a person asks lore-api to make on GitHub appears on GitHub as made by that person, and a person GitHub would refuse is refused.
- **SC-023**: With lore-api running as two replicas, a session ended on one closes that session's live connections on the other.

## Assumptions

- Step 1 (FR-9.20 and FR-9.21 of `specs/4-ux-repo-onboarding/spec.md`) is merged before any step here.
- Before Step 3 is built, it is confirmed on a real installation that a user token of the App can set a repository secret and a repository variable and create a webhook. If it cannot, work on Step 3 stops and ADR-054 is amended; this spec names no other credential for those calls.
- Steps 2 and 3 ship without Step 4.
- An existing install changes its GitHub App's settings once, and an owner of the organisation approves the permission Members (read), before the upgrade. The new mode does not switch on without it (FR-143).
- At the upgrade everyone signs in again and every token minted through Lore is minted again. Decided 2026-11-19.
- lore-api is stopped for the Step 3 upgrade and for a rollback from it, for as long as the cleanup takes (FR-332 to FR-336).
- No session without a GitHub numeric id exists after the upgrade, because the upgrade ends every session (FR-060) and sign-in stores the id from then on (FR-327).
- Five minutes of staleness on reads is accepted. Decided 2026-11-19.
- A session ends when GitHub refuses its refresh token, and is kept when GitHub could not be asked (FR-226 to FR-229). Proposed 2026-11-19; the owner has not confirmed it.
- No scheduled job rechecks membership: a removed member is found at their next request (FR-236 to FR-240).
- Every signed-in member keeps the organisation-wide routes for now. Decided 2026-11-19.

## Open Questions

- **GitHub Enterprise Server** — user access tokens of an App and their refresh are documented there. They have to be confirmed on a real server of the versions installers run. Choices if they fail: stop and amend ADR-054, or keep the OAuth App sign-in on such hosts.
- **The encryption key of FR-025** — Choices: generated by the chart like the other tokens, or required from the installer.
- **When to narrow the organisation-wide routes** — Choices: owners of the GitHub organisation only, or also a named GitHub team.
