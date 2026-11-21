# Feature Specification: GitHub decides who can open a repository

| Field     | Value                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| Feature   | GitHub decides who can open a repository                                                        |
| Branch    | github-decides-repo-access                                                                      |
| Status    | In Progress                                                                                     |
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

- **FR-001**: Every lore-api route that concerns a repository declares the level it needs beside its `bearerScope` ([validated by refuses a person a repository named in a payload, a query, or a record with 403 before the handler runs @d747ca76](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L27), [validated by refuses a caller with no token or a made-up token with 401 on repository and spanning routes @9ad9d6df](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L207), [validated by declares each repository route's level and source beside bearerScope without weakening bearer scope checks @f1654c75](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L329)).
- **FR-257**: Every such route also declares how its repository is found: a path parameter, a payload field, a query parameter, or the record the request names ([validated by refuses a person a repository named in a payload, a query, or a record with 403 before the handler runs @d747ca76](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L27), [validated by refuses a repository that is malformed, the wrong type, or climbs out of owner/name before any chunk or write @036f965e](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L300), [validated by declares each repository route's level and source beside bearerScope without weakening bearer scope checks @f1654c75](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L329)).
- **FR-258**: The repository guard (`registerRepoGuard`) finds the repository the way the route declares, so a repository named in a query, in a payload or through a record is checked like one named in the path ([validated by refuses a person a repository named in a payload, a query, or a record with 403 before the handler runs @d747ca76](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L27), [validated by refuses a repository named in another letter case than the person's list allows @ca61a2f9](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L225), [validated by refuses a record route when looking up the record's repository fails, never reaching the handler @9c6321e6](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L239), [validated by refuses POST /api/ingest for a repository the person cannot read and writes nothing @fcd3651f](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L287), [validated by leaves the runtime of a task that does not exist to its handler, which answers 200 instead of refusing the person @239adc80](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L114)).
- **FR-259**: A route whose answer can hold rows of more than one repository declares that it spans repositories, in place of a way to find one ([validated by returns a person only rows of repositories they can read on routes that span repositories @b902a7d4](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L76), [validated by declares each repository route's level and source beside bearerScope without weakening bearer scope checks @f1654c75](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L329)).
- **FR-260**: A route that spans repositories returns a person only rows of repositories they can read ([validated by returns a person only rows of repositories they can read on routes that span repositories @b902a7d4](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L76), [validated by returns a person whose sign-in list is empty no rows on routes that span repositories @a82f8d56](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L265), [validated by counts 1 repository in the repo list total for a person who can read one, and 2 for a service token @f604d001](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L103)).
- **FR-261**: `GET /api/chunks` asked with no `repo` returns a person only chunks of repositories they can read ([validated by returns a person only chunks of repositories they can read when GET /api/chunks names no repo @f4bd0cbf](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L121), [validated by returns a person whose sign-in list is empty no rows on routes that span repositories @a82f8d56](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L265)).
- **FR-262**: `GET /api/chunks?repo=` is refused for a person who cannot read that repository ([validated by refuses GET /api/chunks?repo= with 403 for a person who cannot read that repository @a6109179](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L142), [validated by refuses GET /api/chunks when the repo parameter is repeated to slip a second repository past the guard @7f4dfe83](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L251)).
- **FR-263**: `GET /api/context?repo=` is refused for a person who cannot read that repository ([validated by refuses GET /api/context?repo= with 403 for a person who cannot read that repository @5d4e5354](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L167), [validated by refuses POST /api/context with 403 when its body names a repository the person cannot read @65e8fddd](apps/lore-api/src/transport/http/repo-guard.acceptance.test.ts#L192)).
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

- **FR-010**: `/api/auth/login` and `/api/auth/callback` sign a person in through the GitHub App's web authorization flow ([validated by returns null when GitHub answers a viewer with an empty login @97fa0218](apps/lore-api/src/outbound/github-user-client.test.ts#L119), [validated by sends a person starting login to the GitHub App authorization URL with the App client id and no OAuth scopes @52f81cdf](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L59), [validated by exchanges the callback code with the GitHub App client id and client secret instead of the OAuth App credentials @42a76678](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L78), [validated by returns the token pair with expiries and refresh token when GitHub provides them @d3e3aad6](apps/lore-api/src/outbound/github-user-client.test.ts#L73), [validated by refuses callback when GitHub answers a non-string token or a viewer with no login and writes no redeem row @d6cdf95c](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L183), [validated by refuses callback when GitHub errors, times out, or reports a pending org invite and writes no redeem row @e462eb5f](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L309), [validated by refuses disallowed or malformed inputs on login, callback, and redeem without writing rows @5d0e836c](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L392)).
- **FR-379**: The GitHub App's client id is a setting of its own (`secrets.githubApp.clientId`, key `client-id` of the Secret `github-app-credentials` in `lore-api`). It is not the App id (`secrets.githubApp.appId`) and not the OAuth App's client id (`secrets.githubOAuth.clientId`) ([validated by sends a person starting login to the GitHub App authorization URL with the App client id and no OAuth scopes @52f81cdf](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L59), [validated by exchanges the callback code with the GitHub App client id and client secret instead of the OAuth App credentials @42a76678](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L78), [validated by reads the GitHub App client credentials, token encryption key, public API address, UI and org from the environment @36b859e9](apps/lore-api/src/transport/routes/auth/oauth-config.test.ts#L19), [validated by returns null when the GitHub App client id is missing @c33e91d3](apps/lore-api/src/transport/routes/auth/oauth-config.test.ts#L30), [validated by refuses login, callback, and redeem when the database or App settings are missing and rolls back when session creation fails @4a11fd89](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L345)).
- **FR-380**: The GitHub App's client secret is a setting of its own (`secrets.githubApp.clientSecret`, key `client-secret` of the same Secret), apart from the OAuth App's (`secrets.githubOAuth.clientSecret`) ([validated by exchanges the callback code with the GitHub App client id and client secret instead of the OAuth App credentials @42a76678](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L78), [validated by reads the GitHub App client credentials, token encryption key, public API address, UI and org from the environment @36b859e9](apps/lore-api/src/transport/routes/auth/oauth-config.test.ts#L19), [validated by returns null when the GitHub App client secret is empty @c008f529](apps/lore-api/src/transport/routes/auth/oauth-config.test.ts#L36)).
- **FR-383**: `/api/auth/login` sends the person to GitHub with the App's client id of FR-379 ([validated by sends a person starting login to the GitHub App authorization URL with the App client id and no OAuth scopes @52f81cdf](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L59), [validated by points at GitHub with the client, callback, and state without OAuth scopes @86d6d07a](apps/lore-api/src/work/auth/login-grant.test.ts#L51)).
- **FR-398**: `/api/auth/callback` exchanges the code with the App's client id and client secret of FR-379 and FR-380 ([validated by exchanges the callback code with the GitHub App client id and client secret instead of the OAuth App credentials @42a76678](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L78)).
- **FR-428**: `/api/auth/callback` stores the token pair GitHub returned, encrypted with the key of FR-025, in a column of its own on the one-time code's row in `lore.login_handoffs` ([validated by stores the encrypted GitHub token pair in its own column on lore.login_handoffs and keeps every token out of grant_json @19d75f33](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L100), [validated by encrypts the token pair onto the redeem handoff and leaves grant token-free @29a87e8c](apps/lore-api/src/transport/routes/auth/callback.test.ts#L151), [validated by refuses callback for a missing or made-up state and for a caller outside the org without storing a redeem row @8336cb6a](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L210)).
- **FR-429**: The grant that row holds as JSON never contains a GitHub token ([validated by stores the encrypted GitHub token pair in its own column on lore.login_handoffs and keeps every token out of grant_json @19d75f33](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L100), [validated by encrypts the token pair onto the redeem handoff and leaves grant token-free @29a87e8c](apps/lore-api/src/transport/routes/auth/callback.test.ts#L151)).
- **FR-430**: `/api/auth/redeem` deletes the code's row, creates the session's row in `pipeline.api_tokens` and stores the session's token row of FR-013 in one transaction ([validated by deletes the handoff row, creates the pipeline.api_tokens session, and stores the encrypted session token row in one transaction on redeem @c6a14026](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L132), [validated by rolls back the handoff deletion and session creation when storing the session token row fails @ded6000f](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L159), [validated by stores the encrypted session token row keyed by the minted session id in one transaction when the handoff carries encrypted tokens @64961c02](apps/lore-api/src/transport/routes/auth/redeem.test.ts#L124), [validated by refuses redeem with a missing, wrong-type, or made-up code and writes no session or token row @9edf2238](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L244), [validated by refuses phase-confused handoff codes across callback and redeem without exchanging or writing rows @e1d5b248](apps/lore-api/src/transport/routes/auth/app-sign-in.acceptance.test.ts#L278)).
- **FR-431**: A code that was already redeemed creates no session and no token row.
- **FR-432**: A code whose row has expired creates no session and no token row.
- **FR-433**: A timer in the lore-api process, once a minute, deletes every row of `lore.login_handoffs` whose expiry has passed, whether or not anyone signs in, so no expired row and no encrypted pair on it outlives its expiry by more than five minutes.
- **FR-468**: That cleanup deletes the whole row, the encrypted pair with it, since the pair is a column of that row.
- **FR-469**: That cleanup changes nothing when it runs twice or in two replicas at once.
- **FR-470**: The delete of expired rows that runs when a new code is stored (`SWEEP_EXPIRED` in `apps/lore-api/src/work/auth/login-handoffs.ts`) stays, beside the timer.
- **FR-026**: After the upgrade, a sign-in through the OAuth App creates no session.
- **FR-011**: A sign-in whose token answer from GitHub carries no expiry is refused and creates no session.
- **FR-028**: A sign-in whose token answer from GitHub carries no refresh token is refused and creates no session.
- **FR-012**: Sign-in admits only a person GitHub reports as an active member of the configured organisation.
- **FR-013**: lore-api stores the person's access token and refresh token encrypted with AES-256-GCM in a table keyed by the session's row in `pipeline.api_tokens` ([validated by mints the session and writes no user_session_tokens row when the handoff carries no encrypted tokens @e081db64](apps/lore-api/src/transport/routes/auth/redeem.test.ts#L155), [validated by stores the encrypted session token row keyed by the minted session id in one transaction when the handoff carries encrypted tokens @64961c02](apps/lore-api/src/transport/routes/auth/redeem.test.ts#L124), [validated by encrypts a token pair without exposing plaintext and decrypts it back with the same key @a0ff232e](apps/lore-api/src/work/auth/token-cipher.test.ts#L7), [validated by refuses to decrypt a sealed token pair whose GCM auth tag or IV was truncated @76a2170e](apps/lore-api/src/work/auth/token-cipher.test.ts#L35), [validated by refuses an empty or wrong key, a key of the wrong byte length, and tampered ciphertext @651b4389](apps/lore-api/src/work/auth/token-cipher.test.ts#L54), [validated by encrypts and decrypts a token pair with a 32-byte base64 key @ff9e26a4](apps/lore-api/src/work/auth/token-cipher.test.ts#L21), [validated by refuses a sealed token pair with an unknown version or extra segment and a 16-byte key on encrypt @8c748bcd](apps/lore-api/src/work/auth/token-cipher.test.ts#L75)).
- **FR-327**: Sign-in stores the person's GitHub numeric user id on the session's row in `pipeline.api_tokens` (the session columns of `deploy/chart/charts/ui-helm/migrations/0121_user_sessions.sql` hold a login and no id today).
- **FR-328**: `pipeline.api_tokens` has an index on that id.
- **FR-329**: Every operation on "every session of a person" (FR-018, FR-027, FR-237, FR-049) selects the sessions by that id, and never by login.
- **FR-330**: Every revocation of "every token a person minted" (FR-238, FR-048) selects the tokens by their maker's id of FR-044, and never by login.
- **FR-388**: `/api/auth/redeem` takes a transaction-scoped PostgreSQL advisory lock keyed by the person's GitHub numeric user id before it creates the session.
- **FR-389**: `POST /api/tokens` called with a person's session takes that same lock before it stores the token.
- **FR-390**: Ending every session of a person and revoking the tokens they minted, after they were found to be no longer an active member, is done under that same lock.
- **FR-391**: The handling of a revocation event takes that same lock for its person.
- **FR-434**: A table keyed by GitHub numeric user id holds one integer for each person, that person's generation; a person with no row has generation 0.
- **FR-394**: Under the person's lock, the cleanup after a person was found to be no longer an active member adds one to that person's generation.
- **FR-435**: Under the person's lock, the handling of a revocation event adds one to that person's generation.
- **FR-436**: `/api/auth/callback` reads the person's generation as soon as GitHub has told it who the person is, before it asks GitHub whether they are a member, and stores the value on the code's row.
- **FR-395**: Under the person's lock, `/api/auth/redeem` creates the session only when the person's generation equals the value on the code's row; otherwise it creates no session and no token row, and the person starts the sign-in again.
- **FR-437**: A session's row records the generation it was created under.
- **FR-396**: Under the person's lock, `POST /api/tokens` stores no token when the session that asks has been ended.
- **FR-438**: Under the person's lock, `POST /api/tokens` stores no token when the generation recorded on the session that asks differs from the person's generation.

Both events add one to the generation, so a sign-in or a mint that began before either of them cannot complete after it. A removal has a second effect that is not Lore's state: the person fails the membership check of FR-012 until GitHub reports them an active member again. After a revocation the person can sign in again at once, and that sign-in authorises the App anew.
- **FR-025**: The key that encrypts the stored tokens is read from a Secret that holds nothing else ([validated by returns null when the user token encryption key is missing @e045341a](apps/lore-api/src/transport/routes/auth/oauth-config.test.ts#L46), [validated by writes lore-user-token-key with the one key `key` and lore-api reads LORE_USER_TOKEN_ENCRYPTION_KEY from it @9fa6c278](libs/shared/src/domain/infra-contract/security-posture.test.ts#L133)).
- **FR-220**: The row that holds a session's stored tokens also holds the access token's expiry.
- **FR-221**: The same row holds the refresh token's expiry.
- **FR-222**: Before lore-api calls GitHub with a person's token, it refreshes that token when the stored access-token expiry is less than five minutes away.
- **FR-223**: A refresh takes the lock on the session's token row before it calls GitHub's refresh endpoint.
- **FR-224**: A refresh replaces both stored tokens and both stored expiries in one transaction.
- **FR-225**: A request that finds the token row locked by a refresh waits for it and uses the token it stored, and starts no refresh of its own.
- **FR-014**: Two refreshes of one session at once leave exactly one valid token pair.
- **FR-226**: When GitHub answers a refresh that the refresh token is invalid, expired or revoked, the session is ended and the person signs in again.
- **FR-227**: When the connection to GitHub for a refresh cannot be opened, so the refresh request was never sent, the request is refused with the answer FR-033 gives when access cannot be checked.
- **FR-228**: After a refresh whose request never left (FR-227), the refreshing mark of FR-393 is cleared and the session and its stored token pair are kept.
- **FR-229**: The next request of that session after a refresh that never left tries the refresh again.
- **FR-022**: A sign-out that arrives while a refresh of the same session is in flight leaves no stored token for that session.
- **FR-023**: A revocation event that arrives while a refresh of that person's session is in flight leaves no stored token for that session.
- **FR-338**: Sign-out takes the lock on the session's token row that a refresh takes (FR-223).
- **FR-339**: The handling of a revocation event takes that same lock for each session of the person.
- **FR-340**: Under that lock, sign-out and revocation delete the stored tokens and mark the session ended in one transaction.
- **FR-341**: A refresh that gets the lock after a sign-out or a revocation finds the session ended and does not call GitHub.
- **FR-015**: A session marked ended is never refreshed.
- **FR-016**: A refresh whose request was sent and that got no definitive answer from GitHub (a timeout, a lost connection, an answer with a 5xx status) has an unknown outcome, because GitHub may have replaced the pair, and ends the session.
- **FR-471**: A refresh that GitHub answers with a 4xx status other than its refusal of the refresh token (FR-226) has an unknown outcome and ends the session.
- **FR-472**: A refresh that GitHub answers with a 2xx status whose body is not a token pair with both tokens and both expiries has an unknown outcome and ends the session.
- **FR-439**: Ending a session for a refresh's outcome (FR-226, FR-016, FR-471, FR-472, FR-397) deletes its stored tokens in the same transaction.
- **FR-393**: Before it sends a refresh request, lore-api sets a refreshing mark on the session's token row in a write of its own, committed before the request leaves.
- **FR-440**: The refreshing mark carries a deadline: the time it was set plus the refresh request's timeout plus one minute.
- **FR-441**: A refresh that GitHub answers with a new pair clears the mark in the transaction that stores the pair (FR-224).
- **FR-442**: A request that finds the mark set and its deadline not yet passed waits until the mark is cleared or the deadline passes, and starts no refresh of its own.
- **FR-397**: A request that finds the mark set and its deadline passed ends the session, so a refresh cut short by a stopped process is never tried again with a pair GitHub may have cancelled.

The refreshing mark has two states, clear and set, and a session's refresh ends in one of these ways only:

| What happens | Mark | Stored pair | Session |
| --- | --- | --- | --- |
| A refresh is about to send its request (FR-393) | set, with its deadline | the old pair | live |
| GitHub answers with a new pair (FR-441) | cleared with the new pair | the new pair | live |
| The connection could not be opened, so nothing was sent (FR-227, FR-228) | cleared | the old pair | live; the request is refused and the next one tries again |
| GitHub refuses the refresh token (FR-226) | gone with the row | deleted | ended |
| The request was sent and no definitive answer came: a timeout, a lost connection, a 5xx (FR-016) | gone with the row | deleted | ended |
| GitHub answers with a 4xx that is not its refusal of the refresh token (FR-471) | gone with the row | deleted | ended |
| GitHub answers 2xx with a body that is not a whole token pair (FR-472) | gone with the row | deleted | ended |
| lore-api stopped; a later request finds the mark past its deadline (FR-397) | gone with the row | deleted | ended |
| Another request arrives while the mark is set and in time (FR-442) | unchanged | unchanged | live; that request waits |
- **FR-017**: Sign-out (`/api/auth/logout`) deletes the session's stored tokens.
- **FR-018**: A `github_app_authorization` revocation event with a valid signature deletes the stored tokens of that person.
- **FR-027**: A `github_app_authorization` revocation event with a valid signature ends every session of that person.
- **FR-019**: An event sent to the App's webhook is verified, before it is read, with a signing secret that is no repository's webhook secret.
- **FR-024**: An event sent to the App's webhook with a bad signature changes nothing.
- **FR-020**: lore-api accepts two App webhook secrets at once while one is being replaced.
- **FR-021**: The same timer in the lore-api process deletes the stored tokens of every session that has expired.

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

- **FR-143**: Before anything is stopped, the release of the upgrade runs a check that asks GitHub, as the App, for the configured installation (`GET /app/installations/{installation_id}` with the App's JWT). It needs no signed-in person.
- **FR-443**: That check fails the upgrade when the installation's account is not the configured organisation.
- **FR-385**: That check fails the upgrade when the permissions the installation was granted do not include Members (read).
- **FR-444**: That check then mints an installation token and asks GitHub for one member of the organisation (`GET /orgs/{org}/members?per_page=1`), and fails the upgrade when that request does not succeed.
- **FR-386**: That check fails the upgrade when the App's client id or client secret of FR-379 and FR-380 is not set.
- **FR-473**: Before anything is stopped, that check also runs the configuration validation the incoming release runs at start for the new mode (FR-064), against the values and the Kubernetes Secrets of the cluster, and fails the upgrade when it fails.
- **FR-474**: That validation fails for each setting of the table below that is missing, and for each Secret or key of the table that does not exist in the namespace lore-api reads it from.
- **FR-475**: The validation names every missing setting, Secret and key in its output, not only the first.
- **FR-145**: When that check fails for any reason (FR-443, FR-385, FR-444, FR-386, FR-473), lore-api is not stopped, no session is ended and no minted token is revoked, and the outgoing release goes on serving.
- **FR-387**: The chart stops lore-api and runs the cleanup of FR-332 only after that check has passed.
- **FR-381**: At start, lore-api refuses to run in the new mode when the App's client id is missing.
- **FR-382**: At start, lore-api refuses to run in the new mode when the App's client secret is missing.

The settings the new mode needs, each checked before anything is stopped (FR-474) and again at start (FR-064):

| Setting | Where it is read from |
| --- | --- |
| The App's id, private key and installation id | Secret `github-app-credentials`, keys `app-id`, `private-key`, `installation-id` |
| The App's client id (FR-379) | Secret `github-app-credentials`, key `client-id` |
| The App's client secret (FR-380) | Secret `github-app-credentials`, key `client-secret` |
| The key that encrypts stored tokens (FR-025) | a Secret of its own that this spec introduces |
| The App webhook's signing secret (FR-019) | a Secret key that this spec introduces, apart from `lore-webhook-secret` |
| The OAuth App's client id and secret, kept for a rollback (FR-147) | Secret `lore-github-oauth`, keys `client-id`, `client-secret` |
| The configured organisation (`GITHUB_ORG`) | lore-api's environment |

What the check cannot see shows at the first sign-in, as stated above: an App without expiring user tokens gives a token answer with no expiry or no refresh token, and that sign-in is refused (FR-011, FR-028). After the upgrade, a membership question GitHub refuses for want of permission still admits nobody and is reported as a fault of the install (FR-043, FR-142).

- **FR-064**: At start, lore-api runs the same validation and refuses to run in the new mode when a setting of the table above is missing. It is the second line after the check before the upgrade, for an install that changed between the two.
- **FR-065**: lore-api reads the permissions its installation was granted through GitHub's API (`GET /app/installations/{installation_id}`) and writes a warning to its log for each required permission that is missing.
- **FR-208**: lore-api reads the App's webhook configuration through GitHub's API (`GET /app/hook/config`) and writes a warning to its log when no webhook address is set.
- **FR-146**: The settings page shows each App permission or webhook setting that lore-api found missing.
- **FR-066**: The install guide (`docs/github-setup.md`) carries a checklist of the App's settings that lore-api cannot read back.
- **FR-217**: The checklist names the callback URL.
- **FR-384**: The checklist names the App's client id, and says it is not the App id.
- **FR-179**: The checklist names the client secret.
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
- **FR-147**: The release of the upgrade keeps the OAuth App's client id and secret in the values file under their own keys (`secrets.githubOAuth`), beside the App's of FR-379 and FR-380, and the older release reads only those after a rollback.
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
- **SC-016**: A session whose access token has expired keeps working without a new sign-in while its refresh token is valid. It ends when GitHub refuses the refresh token and after any refresh that was sent and did not come back with a new pair, a server error included; it is kept only when the refresh request never left lore-api.
- **SC-018**: A person who cannot read a repository gets none of its rows from a route that takes the repository in a query or whose answer spans repositories.
- **SC-021**: A live connection of a person removed from the organisation is closed at its first frame more than five minutes after its last check, and at once when their session is ended.
- **SC-022**: A change a person asks lore-api to make on GitHub appears on GitHub as made by that person, and a person GitHub would refuse is refused.
- **SC-023**: With lore-api running as two replicas, a session ended on one closes that session's live connections on the other.
- **SC-031**: An install whose App lacks the permission Members (read), or that lacks any setting or Secret key the new mode needs (the App's client id or secret, the token encryption key, the App webhook's signing secret, the OAuth App's pair kept for a rollback), fails the upgrade before lore-api is stopped, and goes on serving with every session intact.
- **SC-032**: A person who signs in or mints a token at the moment they are found removed ends with no session and no token.

## Assumptions

- Step 1 (FR-9.21 and FR-9.22 of `specs/4-ux-repo-onboarding/spec.md`) is merged before any step here.
- Before Step 3 is built, it is confirmed on a real installation that a user token of the App can set a repository secret and a repository variable and create a webhook. If it cannot, work on Step 3 stops and ADR-054 is amended; this spec names no other credential for those calls.
- Steps 2 and 3 ship without Step 4.
- An existing install changes its GitHub App's settings once, and an owner of the organisation approves the permission Members (read), before the upgrade. The upgrade does not start without it, nor without every setting the new mode needs (FR-143, FR-385, FR-443, FR-444, FR-473 to FR-475).
- At the upgrade everyone signs in again and every token minted through Lore is minted again. Decided 2026-11-19.
- lore-api is stopped for the Step 3 upgrade and for a rollback from it, for as long as the cleanup takes (FR-332 to FR-336).
- No session without a GitHub numeric id exists after the upgrade, because the upgrade ends every session (FR-060) and sign-in stores the id from then on (FR-327).
- Five minutes of staleness on reads is accepted. Decided 2026-11-19.
- A session ends when GitHub refuses its refresh token, and when a refresh request was sent and did not come back with a new pair (no answer, a server error, any other error status, a body that is not a pair); it is kept only when the request never left lore-api (FR-016, FR-226 to FR-229, FR-393 to FR-442, FR-471, FR-472). Proposed 2026-11-19; the owner has not confirmed it.
- No scheduled job rechecks membership: a removed member is found at their next request (FR-236 to FR-240).
- A local client (the local MCP server, the VS Code extension) signs in by Lore's own pairing, specified in the second spec, so the App's device flow does not have to be switched on. Proposed 2026-11-19; the owner has not confirmed it. A session made by a pairing stores no GitHub token of its own and uses the same person's stored token, so FR-013 holds for the sessions that sign in on the web.
- Every signed-in member keeps the organisation-wide routes for now. Decided 2026-11-19.

## Open Questions

- **GitHub Enterprise Server** — user access tokens of an App and their refresh are documented there. They have to be confirmed on a real server of the versions installers run. Choices if they fail: stop and amend ADR-054, or keep the OAuth App sign-in on such hosts.
- **The encryption key of FR-025** — Choices: generated by the chart like the other tokens, or required from the installer.
- **When to narrow the organisation-wide routes** — Choices: owners of the GitHub organisation only, or also a named GitHub team.
