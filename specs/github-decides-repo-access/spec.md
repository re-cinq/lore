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

The requirements of this step are FR-9.20 and FR-9.21 of `specs/4-ux-repo-onboarding/spec.md`, added by the change that introduces the guard. They are not repeated here.

### Step 2: levels

- **FR-001**: Every lore-api route that names a repository declares the level it needs, and the repository guard answers a person `403` when the level GitHub reports for them on that repository is below it.
- **FR-002**: A route that only shows a repository's data needs `read`.
- **FR-003**: A route that commits, creates a branch, opens or merges a pull request, files an issue or starts a run needs `write`.
- **FR-004**: Onboarding and re-onboarding a repository, the repository's settings in Lore and its auto-merge setting need `admin`.
- **FR-005**: A `write` or `admin` route asks GitHub at the time of the request and never answers from a cached level.
- **FR-006**: lore-api has no route that returns a webhook signing secret.

### Step 3: user access tokens

#### Sign-in and stored tokens

- **FR-010**: lore-api signs a person in through the GitHub App's web authorization flow, and the OAuth App takes no part in deciding access.
- **FR-011**: A sign-in whose token answer from GitHub carries no expiry or no refresh token is refused and creates no session.
- **FR-012**: Sign-in admits only a person GitHub reports as an active member of the configured organisation.
- **FR-013**: lore-api stores the person's access token and refresh token encrypted with AES-256-GCM in a table beside the session row, with the key read from a Secret that holds nothing else.
- **FR-014**: Refresh, sign-out and revocation of a session take the same row lock, so two refreshes at once leave exactly one valid token pair.
- **FR-015**: A session marked ended is never refreshed, including when a refresh was in flight as it ended.
- **FR-016**: A refresh whose outcome is unknown ends the session.
- **FR-017**: Sign-out deletes the session's stored tokens.
- **FR-018**: A `github_app_authorization` revocation event with a valid signature deletes the stored tokens of that person and ends their sessions.
- **FR-019**: The App's webhook is verified with a signing secret of its own, apart from the repositories' webhook secrets, before the event is read; an event with a bad signature changes nothing.
- **FR-020**: lore-api accepts two App webhook secrets at once while one is being replaced.
- **FR-021**: A scheduled sweep deletes the stored tokens of every session that has expired.

#### What a person sees and does

- **FR-030**: Lists of repositories, search results and inbox results show a person only repositories returned by `GET /user/installations/{installation_id}/repositories` asked with that person's token.
- **FR-031**: Every read of what Lore has stored about a repository is refused for a person whose list does not contain that repository.
- **FR-032**: A person's repository list is kept per session for at most five minutes.
- **FR-033**: When the list is older than five minutes and GitHub gives no fresh answer, reads are refused and are not served from the old list.
- **FR-034**: A change a person asks for at the moment of the request (onboarding, settings, opening or merging a pull request, filing an issue) is made on GitHub with that person's token.
- **FR-035**: On a repository route, GitHub's answer decides for a person, whatever scope their session carries.
- **FR-036**: A signed-in member can use the organisation-wide routes.
- **FR-037**: The web UI's server holds no GitHub credential and reads GitHub only through lore-api.

#### Membership and minted tokens

- **FR-040**: lore-api asks GitHub whether the person is still an active member of the organisation whenever it refreshes their repository list.
- **FR-041**: A person GitHub no longer reports as an active member has every session ended.
- **FR-042**: When the membership answer is older than five minutes and GitHub gives no fresh one, the organisation-wide routes are refused.
- **FR-043**: A membership question that GitHub refuses for want of permission is reported as a fault of the install and admits nobody.
- **FR-044**: A token minted by a person records that person's GitHub numeric id.
- **FR-045**: When a minted token is used and the last membership answer for its maker is older than five minutes, lore-api asks GitHub, as the App, before it serves the request.
- **FR-046**: A request made with a token whose maker is no longer an active member is refused, and every token that person minted and every session of theirs is revoked.
- **FR-047**: A token the install provisions itself (the stations token, an operator's emergency token) cannot be minted through the route people use.

#### Repository identity

- **FR-050**: Access and credentials are recorded against a repository's GitHub numeric id, so a repository that takes another's name does not take its access.
- **FR-051**: The migration fills each repository row's id by asking GitHub through the installation.
- **FR-052**: A repository row whose id cannot be found, or equals another row's, is refused to every caller until an operator resolves it.

#### The upgrade and the rollback

- **FR-060**: The upgrade ends every session that existed before it.
- **FR-061**: The upgrade revokes every token minted before it.
- **FR-062**: A minted token carries a mark of the kind of release that made it.
- **FR-063**: The rollback step runs before the older release serves a request, and after it no session, no token minted since the upgrade and no stored GitHub token remains.
- **FR-064**: At start, lore-api refuses to run in the new mode when a setting the values file must carry for it is missing.
- **FR-065**: lore-api reads the App's permissions and webhook through GitHub's API and reports a missing one as a warning in its log and on the settings page.
- **FR-066**: The install guide carries a checklist of the App's settings that lore-api cannot read back: the callback URL, the client secret, the device flow, expiring user tokens, the webhook address and its secret, and the organisation permission Members (read).

### Step 4: callers that are not people

#### A repository's CI

- **FR-070**: lore-api accepts a GitHub Actions identity token for ingest only when its issuer is exactly the configured GitHub host's and its signature matches a key that issuer publishes.
- **FR-071**: An identity token whose audience is not this install's own address is refused.
- **FR-072**: An identity token outside its validity period (`iat`, `nbf`, `exp`) is refused.
- **FR-073**: An identity token's `jti` is recorded in the database under a unique key before the request is handled and until the token expires, so the same token sent twice, to one replica or to two at once, is accepted once.
- **FR-074**: An identity token is accepted only when its `repository_id` and `repository_owner_id` match an onboarded repository, and it allows ingest for that repository only.
- **FR-075**: An identity token is accepted only when its `workflow_ref` names the workflow Lore installed, on the repository's default branch.
- **FR-076**: An identity token from a pull request of a fork is refused.
- **FR-077**: lore-api issues no longer-lived credential in exchange for an identity token.
- **FR-078**: Where the identity token cannot be used, a repository's CI holds a stored token that carries only the ingest scopes and is refused for any other repository.

#### Agent runs

- **FR-080**: A run started by a person records that person's GitHub numeric id and the repository's id.
- **FR-081**: Each time the floor asks lore-api for a run's GitHub credential, lore-api asks GitHub, as the App, for the starter's level on the repository and mints an installation token only when it is `write` or above.
- **FR-082**: A run whose starter no longer has `write` gets no further credential and is cancelled.
- **FR-083**: When a run ends or is cancelled, lore-api revokes every installation token it minted for it.
- **FR-084**: A run goes on after its starter signs out.
- **FR-085**: The MCP gateway accepts from an agent pod only the token the floor signed for that visit, and verifies the signature with the floor's public key.
- **FR-086**: lore-api verifies the same token and applies the repository guard to it, so an agent's call for a repository other than its run's is refused.
- **FR-087**: A visit's token is refused after the visit ends.

The token's format, the rotation of the floor's key and what a long visit does at expiry are deferred to a spec of their own, to be written before Step 4 starts.

#### Runs Lore starts itself

- **FR-090**: Each repository has a setting that says whether a pull request from an author without `write` starts a review, and it is off by default.
- **FR-091**: A run started by an event whose author has no `write` gets a read-only GitHub token and no tool that writes, in GitHub or in Lore.
- **FR-092**: The findings of such a run are posted as a comment, never as an approving review or a passing check.
- **FR-093**: A scheduled job authenticates with the stations token.

#### Stations, laptops and the editor

- **FR-100**: The stations service and its scheduled jobs authenticate with a named system token that carries only the scopes their jobs use.
- **FR-101**: The stations token can be replaced without changing any other credential.
- **FR-102**: The local MCP server signs a person in with the App's device flow and holds a session for that person.
- **FR-103**: The VS Code extension signs a person in with the App's device flow and holds a session for that person.

#### Webhook secrets

- **FR-110**: Each repository's webhook has a signing secret of its own, stored encrypted against the repository's id.
- **FR-111**: The first Step 4 release accepts a delivery signed with either the shared secret or the repository's own, and an ingest request with either the stored token or the identity token.
- **FR-112**: After a rollback to the first Step 4 release, the webhooks and workflows of repositories already moved still work.
- **FR-113**: Once no webhook uses the shared secret, a delivery signed with it is refused.

#### The shared admin token

- **FR-120**: lore-api logs every use of the token it reads from its environment, with the caller.
- **FR-121**: After the withdrawal, lore-api accepts no token from its environment.
- **FR-122**: No workload of a rendered install holds the shared admin token.
- **FR-123**: An operator mints an emergency token with a command inside the cluster; the token names the operator, expires within hours, and its minting is written to the audit log.

#### What operators can see

- **FR-130**: lore-api exports counts of refused requests by reason, failed token refreshes, refused identity tokens, failed revocation events, uses of the shared admin token by caller, and repositories still on the shared webhook secret.

## Success Criteria

- **SC-001**: For every repository route, a person one level below what the route needs is refused.
- **SC-002**: A person without `admin` on a repository cannot onboard it.
- **SC-003**: A removed grant refuses the person's next write and, after five minutes at most, every read.
- **SC-004**: A member who is no repository's administrator still opens the organisation-wide pages, and a non-member cannot sign in.
- **SC-005**: A person removed from the organisation has their sessions ended within five minutes, and a token they minted is refused at its next use, including one left unused since before they were removed.
- **SC-006**: After the upgrade, no session and no minted token from before it is accepted.
- **SC-007**: After a rollback, no session, no token minted since the upgrade and no stored GitHub token remains.
- **SC-008**: A workflow's credential for one repository is refused for another, and so is an agent's.
- **SC-009**: A pull request from an author without `write` starts nothing by default and never yields an approval.
- **SC-010**: Nothing in a rendered install holds the shared admin token.

## Assumptions

- The requirements of Step 1 land with the change that introduces the guard, before any step here.
- Steps 2 and 3 can ship without Step 4; Step 4 takes two releases.
- An existing install changes its GitHub App's settings once, and an owner of the organisation approves the permission Members (read), before the upgrade.
- At the upgrade everyone signs in again and every token minted through Lore is minted again. Decided 2026-11-19.
- Five minutes of staleness on reads is accepted. Decided 2026-11-19.
- Agents keep an installation token for one repository; an agent that holds no GitHub token at all is a later option and not part of this spec.
- Every signed-in member keeps the organisation-wide routes for now. Decided 2026-11-19.

## Open Questions

- **GitHub Enterprise Server** — Choices: use the device flow and the Actions identity token there, or fall back to the stored per-repository token and a browser sign-in. Both have to be confirmed on a real server of the versions installers run.
- **A user token of the App setting a repository secret and creating a webhook** — Choices: onboarding is made with the person's token as FR-034 says, or, if GitHub refuses those calls for a user token, with the App's token after the `admin` check of FR-004. To be confirmed on a real installation.
- **A session whose refresh fails** — Choices: the session ends, or it falls back to read-only until the person signs in again.
- **The encryption key of FR-013** — Choices: generated by the chart like the other tokens, or required from the installer.
- **When to narrow the organisation-wide routes** — Choices: owners of the GitHub organisation only, or also a named GitHub team.
