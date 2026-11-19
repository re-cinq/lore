---
adr_number: 54
title: "GitHub decides who can open a repository, and every caller that is not a person has its own narrow token"
status: draft
date: 2026-11-18
deciders: []
domains: [authentication, authorization, lore-api, web-ui, mcp-gateway, security]
---

# ADR-054: GitHub decides who can open a repository, and every caller that is not a person has its own narrow token

This is a draft for review. Nothing in it is decided. It proposes how Lore answers "may this caller do this to this repository", for people and for the callers that are not people, and in what order to build it. It amends ADR-053.

## Background

Lore acts on GitHub with its GitHub App, which can read and write every repository it is installed on. Who may ask Lore to use that access is decided by Lore alone, and today the answer is too wide in three ways.

- **A person's access is a list taken once.** At sign-in lore-api reads the repositories the person can open through a separate OAuth App with the `repo` scope, stores the names on the session and discards the token (ADR-053). The list is never refreshed, stops at 1000 repositories, and is checked on the run routes only. Every other route trusts the session's scope.
- **Every session has the `admin` scope.** Lore has no roles, so a member of the organisation can use every route.
- **Most callers that are not people share one token.** The value of `lore-ingest-token` is every scope with no expiry and no owner, and lore-api accepts it from its environment without a database row. The MCP gateway, the stations service, its scheduled jobs, every onboarded repository's CI, every developer's laptop and the VS Code extension hold it. The floor, the agent subsystem and the gateway's own front door already have tokens of their own.

A first change, already written, puts one question ("can this person open this repository") behind every route that names a repository in its path, and answers it for a repository outside the sign-in list by asking GitHub, as the App, what the person may do there. It closes the widest gap, but Lore still makes the decision, still does not tell read from write, and still learns of a removed grant only when it asks again.

## Proposal

### 1. A person signs in through the GitHub App, and lore-api keeps their user access token

A GitHub App can issue a user access token: a token that acts as the person, limited to what both the person and the App may do, and only in accounts where the App is installed. GitHub checks every call made with it against the person's permission at that moment.

- lore-api runs the App's own web authorization flow in place of the OAuth App's. The separate OAuth App and its `repo` scope, which reaches every repository the person has anywhere, are retired. An installer creates one GitHub App and nothing else.
- The token expires after 8 hours and comes with a refresh token that lasts 6 months and is replaced on each use, but only when the App has expiring user tokens switched on. That setting becomes a requirement of the install. lore-api refuses a sign-in whose token answer carries no expiry or no refresh token, so a misconfigured App cannot leave a token that never expires.
- lore-api stores both tokens encrypted (AES-256-GCM, key in a Secret of its own) in a table beside the session row.
- Refresh, sign-out and revocation all take the same row lock, and a session marked ended can never be refreshed back to life. A refresh whose outcome is unknown (lore-api stopped between GitHub's answer and the commit) ends the session and the person signs in again, because GitHub has already cancelled the old pair.
- Tokens are deleted at sign-out, when GitHub sends `github_app_authorization` (the person revoked the App), and by a scheduled sweep once the session has expired. Today an expired session row is only ignored, never deleted.
- `github_app_authorization` is sent to the App's own webhook address, which installs do not set today because Lore's events arrive through a webhook on each repository. Step 3 adds the address and a signing secret of its own, kept apart from the repositories' webhook secrets. lore-api verifies the signature before it reads the event and accepts two secrets while one is being replaced.
- This reverses one line of ADR-053, "the GitHub token never outlives the callback request". The reason for that line was to hold as little as possible. The cost of holding nothing is that Lore must guess at access; the proposal is to hold a token GitHub has already narrowed, protect it, and let GitHub answer.

### 2. GitHub answers the access question

- **Which repositories a person sees and reads.** `GET /user/installations/{installation_id}/repositories` with the person's token lists the repositories of this installation the person can access, with their permission on each. Lore's lists (onboarded repositories, repositories available to onboard, search and inbox results) are filtered to that list, and so is every read of what Lore has stored about a repository, because those reads never reach GitHub and nothing else would refuse them. The list is kept per session for at most five minutes. Past five minutes without a fresh answer from GitHub, reads are refused, not served from the old list. So a removed grant can still read Lore's stored data about that repository for up to five minutes, and no longer.
- **What a person may do.** Each route states the level it needs, and the rule is that Lore never does for a person what GitHub would refuse them: `read` to see, `write` for what a person with push access can do (commit, branch, pull request, issue, starting a run), `admin` for what only a repository administrator can do. Onboarding sets repository secrets and variables and creates a webhook, so onboarding and re-onboarding need `admin`, as do the repository's settings in Lore and auto-merge. The guard that already sits in front of every repository route compares the level GitHub reports with the level the route needs. A `write` or `admin` action asks GitHub at the time of the action, not from the cache.
- **Things that belong to no repository** (agent definitions, tokens, organisation settings, pools, the audit log, pack sync) stay open to every signed-in member for now, as they are today. Decided 2026-11-19. It is a known gap, not a goal: any member can still mint a token with any scope, so step 4's narrow credentials do not bind a member who wants a wide one. Narrowing it later to owners of the GitHub organisation needs the App's organisation permission Members (read).
- **A repository is identified by GitHub's numeric id**, not its name, wherever access is recorded or a credential is bound, so a renamed, transferred or re-created repository does not inherit another's access.
- **Lore's own scopes stay for callers that are not people.** A person's session keeps `admin` for the routes that belong to no repository, and on a repository route it is GitHub's answer that decides, not the scope.

### 3. Who performs the action: the person, with their own token

Decided 2026-11-19: when a person asks for a change, lore-api makes it with that person's token. GitHub then enforces everything itself, including branch rules as they apply to that person, and attributes the change to them. Lore needs no rule of its own for these: a person who is not an administrator of the repository cannot onboard it, because GitHub refuses the secret, the variable and the webhook.

This covers what lore-api does at the moment of the request: onboarding, settings, opening or merging a pull request, filing an issue.

It does not cover agent runs, and the reason is the size of the token. An App installation token can be narrowed to one repository and a few permissions; a person's token cannot, and reaches every repository of the installation that the person can access. An agent reads repository content that may be written to steer it, so it must not hold that. Agent runs keep the App's token for one repository, under these rules:

- A run records who asked and the repository's id. The floor asks lore-api for the run's GitHub credential at each station, and lore-api asks GitHub, as that person, whether they still have `write` before it mints one. If not, the run is cancelled.
- When a run is cancelled or ends, lore-api revokes the installation tokens it minted for it, so a copy of the token is useless.
- Between two checks an agent can still write for up to an hour with the token it holds, and GitHub applies branch rules to the App, not to the person. This is the remaining gap of letting agents write directly.

Closing that gap means agents hold no GitHub token and every push and pull request goes through lore-api, which checks the person each time. That is a larger change to how agents work and is an open question below.

Whether a user token of the App can set a repository secret and create a webhook has to be confirmed on a real installation.

### 4. Callers that are not people

A token that is not a person's has no GitHub identity to honour. Each such caller gets a credential that can do its one job and nothing else, and none of them is the shared admin token.

| Caller | Today | Proposed |
| --- | --- | --- |
| A repository's CI (ingest, test report, trace impact) | the admin token as a repository secret | GitHub Actions' own OIDC token: the workflow asks GitHub for a signed token that names its repository, and lore-api verifies it and allows ingest for that repository only. No secret is stored in the repository. Where OIDC is not available, a stored token bound to that one repository with only the ingest scopes. |
| Agent pod to the MCP gateway | one bearer for all agents; the gateway then uses the admin token | The run's own short-lived token, which the floor already issues per visit. The gateway checks it, learns the run and its repository, and calls lore-api with a token bound to that repository. An agent can read and write Lore's context for its own repository only. |
| Agent pod to GitHub | an installation token for one repository, 1 hour, with write access to contents, issues, pull requests and workflows | The same token, minted only after GitHub confirms the person who started the run still has `write`, and revoked when the run ends (section 3). A run Lore starts itself follows the rules below the table. |
| Stations service and its scheduled jobs (the courier CronJobs) | the admin token | A named system token with the scopes its sweeps use. It works across repositories by design, never leaves the cluster, and can be rotated on its own. |
| The floor to lore-api | two shared tokens | unchanged in kind: system to system, inside the cluster. |
| The web UI's server | the person's session, plus the App's private key for its own GitHub reads | the person's session only. The UI asks lore-api, which reads GitHub with the person's token. The UI holds no GitHub credential. |
| A developer's laptop (the local MCP server and the VS Code extension) | the admin token, copied from the cluster into git config or the editor's settings | The person signs in from the terminal or the editor with the App's device flow and the laptop holds a session for that person. It can do what they can do. |
| GitHub's webhooks to Lore | one signing secret for all repositories, readable through the API | a secret per repository, stored encrypted against the repository's id and never served by the API. |
| The static admin token | every caller above | removed. lore-api stops accepting a token from its environment. An operator who needs emergency access mints a token with a command inside the cluster: it names the operator, expires within hours and is written to the audit log. |

**Runs Lore starts itself.** Today a pull request opened by anyone, a fork included, starts a review when auto-review is on for the repository, with no check of who opened it. The review agent's token is read-only, and the write token goes only to the follow-up run that a trusted reviewer starts. What an outsider gets today is agent time at the installer's cost, and a say in a verdict that Lore then posts under its own name as an approving review and a passing check. The rules proposed:

- **Whether a run starts.** Each repository says whether a pull request from someone without `write` starts a review at all; the default is no. Pushes to the same pull request replace the waiting review instead of adding one, and each repository has a cap on reviews per hour.
- **What the run may do.** A run started by an event is trusted only as far as the person behind the event. Without `write`, the agent gets a read-only token and no tool that writes, in GitHub or in Lore, and Lore posts its findings as a comment, never as an approval or a passing check.
- A scheduled job runs as the stations token with a fixed list of operations.

**The Actions identity token.** lore-api accepts it only when all of these hold:

- the issuer is exactly the configured GitHub host's, and the signature matches the keys that issuer publishes, fetched and refreshed from it;
- the audience is this Lore install's own address, so a token minted for another service is refused;
- it is within its validity period (`iat`, `nbf`, `exp`), and its `jti` has not been seen before; lore-api remembers each one until it expires;
- `repository_id` and `repository_owner_id` match an onboarded repository. A GitHub Enterprise Server version without those claims does not use the identity token at all and uses the per-repository token;
- the workflow is the one Lore installed, read from `workflow_ref` (it is an ordinary workflow, so `job_workflow_ref` is not set), running on the repository's default branch;
- the event is not a pull request from a fork.

It buys ingest for that repository for that one request; lore-api issues nothing longer-lived in exchange.

**The run's gateway credential.** The floor already signs a token for each visit of a run. The proposal is that the gateway verifies that signature itself (the floor's signing key becomes a key pair, and the gateway holds only the public half), reads the run id, the repository id, the scopes and the expiry from it, and forwards it to lore-api, which verifies it the same way and applies the repository guard to it. The token lasts as long as the visit and is refused after the visit ends. The format, the key rotation and what a long visit does at expiry are to be written as a spec of their own before step 4 starts.

### 5. Order of work

1. **The guard and the single question** (written, in review): every repository route asks, and onboarding asks.
2. **Levels**: routes state `read`, `write` or `admin`; the answer still comes from the App asking about the person. Removes the route that serves the webhook secret.
3. **User access tokens**: sign-in through the App, token storage and refresh, lists filtered by GitHub's list, organisation owners for organisation-wide routes. The web UI stops holding the App's key. There is no period in which both sign-ins decide access: the upgrade ends every existing session, because an old session has the `admin` scope and no GitHub token to check with, and everyone signs in again. The OAuth App's settings stay in the values file for one release so a rollback can sign people in, and a rollback also ends every session.
4. **Callers that are not people**: CI by OIDC, the run-bound gateway credential, the stations token, device-flow sign-in for laptops and the editor, the rule for runs Lore starts itself, and a webhook secret per repository. Each repository's webhook is moved to its own secret while lore-api accepts either the old or the new one, and the shared secret is dropped when no webhook uses it. The shared admin token is withdrawn last: lore-api logs every use of it by caller, and it is removed after a release in which the log shows none.

Steps 1 and 2 need no change to an install. Step 3 needs, on the App: a callback URL, a client secret, the device flow and expiring user tokens switched on, a webhook address and its signing secret; and a database migration. lore-api cannot read most of these settings back from GitHub, so they are checked three ways: what is in the values file, at start; the App's permissions and webhook, through GitHub's API, as a warning in the log and on the settings page; and the rest where they show, with a sign-in refused when its token has no expiry and the device flow tried when someone first uses it. The install guide gets a checklist an operator runs before the upgrade. Step 4 changes the workflows Lore installs in repositories.

Each step is done when tests show its boundary holds, not when the code is merged:

- **Levels**: for every route, a person one level below what it needs is refused; a person without repository admin cannot onboard.
- **User tokens**: a removed grant refuses the next write and, after five minutes at most, every read; reads are refused when GitHub has not answered for five minutes; two refreshes at once leave one valid pair; a sign-out during a refresh leaves no token; an expired session's tokens are gone after the sweep; an old session is refused after the upgrade and after a rollback; a revocation event with a bad signature is ignored.
- **Callers that are not people**: a workflow's token for one repository is refused for another, and so is an agent's; an identity token with the wrong issuer, audience or workflow, from a fork, expired or used twice is refused; a run whose starter lost `write` gets no further credential and its minted tokens are revoked; a pull request from someone without `write` starts nothing by default and never yields an approval; a webhook signed with the old secret is accepted during the move and refused after it; an emergency token names its operator in the audit log; nothing in a rendered install holds the admin token.
- **What operators can see**: counts of refused requests by reason, failed token refreshes, refused identity tokens, failed revocation events, uses of the shared admin token by caller, and repositories still on the shared webhook secret.

## Rationale

- **GitHub is already the record of who may touch a repository.** A second record in Lore can only be the same or wrong.
- **A removed grant takes effect at once** for a change a person asks for, within five minutes for what they can read, and at the next station for an agent run they started.
- **The sign-in asks for less.** The OAuth App's `repo` scope covers a person's repositories everywhere. The App's token covers only where the App is installed.
- **One leak is one repository.** With the proposed credentials, a workflow's token, an agent's token or a repository secret opens one repository's data in Lore, where today each opens the whole install.

## Consequences

- lore-api holds encrypted GitHub tokens for signed-in people. Its database and the encryption key become more sensitive, and a backup of the table without the key must be useless.
- Every read depends on an answer from GitHub no older than five minutes. If GitHub cannot be reached for longer, Lore refuses reads and changes for people until it can.
- More calls to GitHub, counted against each person's own rate limit, not the App's.
- Changes a person asks for appear on GitHub under their name, not the Lore bot's. Changes made by agents and scheduled jobs stay under the bot's.
- An existing install has to change its GitHub App's settings and its values file once.

## Open Questions

- **Should agents stop holding a GitHub token**, with every push and pull request made by lore-api after a check (section 3)? It closes the last hour of the gap and is a large change to agents.
- **When to narrow the organisation-wide pages**, which stay open to every member for now.
- **GitHub Enterprise Server**: user access tokens and their refresh are documented there. The device flow and Actions OIDC on the versions our installers run have to be confirmed on a real server.
- **Session length**: Lore's session can last 30 days and the refresh token 6 months. Should a session end when a refresh fails, or fall back to read-only?
- **Five minutes**: is it acceptable that a removed grant can still read Lore's stored data about a repository for up to five minutes?
- **Encryption key**: generated by the chart like the other tokens, or required from the installer?
