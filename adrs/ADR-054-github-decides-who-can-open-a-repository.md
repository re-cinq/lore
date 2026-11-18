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
- **Callers that are not people share one token.** The value of `lore-ingest-token` is every scope with no expiry and no owner. The MCP gateway, the stations service, every onboarded repository's CI and every developer's laptop hold it.

A first change, already written, puts one question ("can this person open this repository") behind every route that names a repository in its path, and answers it for a repository outside the sign-in list by asking GitHub, as the App, what the person may do there. It closes the widest gap, but Lore still makes the decision, still does not tell read from write, and still learns of a removed grant only when it asks again.

## Proposal

### 1. A person signs in through the GitHub App, and lore-api keeps their user access token

A GitHub App can issue a user access token: a token that acts as the person, limited to what both the person and the App may do, and only in accounts where the App is installed. GitHub checks every call made with it against the person's permission at that moment.

- lore-api runs the App's own web authorization flow in place of the OAuth App's. The separate OAuth App and its `repo` scope, which reaches every repository the person has anywhere, are retired. An installer creates one GitHub App and nothing else.
- The token expires after 8 hours and comes with a refresh token that lasts 6 months and is replaced on each use. lore-api stores both encrypted (AES-256-GCM, key in a Secret of its own) in a table beside the session row, refreshes under a row lock because a refresh token works once, and deletes them at sign-out, at session expiry and when GitHub sends `github_app_authorization` (the person revoked the App).
- This reverses one line of ADR-053, "the GitHub token never outlives the callback request". The reason for that line was to hold as little as possible. The cost of holding nothing is that Lore must guess at access; the proposal is to hold a token GitHub has already narrowed, protect it, and let GitHub answer.

### 2. GitHub answers the access question

- **Which repositories a person sees.** `GET /user/installations/{installation_id}/repositories` with the person's token lists the repositories of this installation the person can access, with their permission on each. Lore's lists (onboarded repositories, repositories available to onboard, search and inbox results) are filtered to that list. It is cached per session for a few minutes.
- **What a person may do.** Each route states the level it needs: `read` to see, `write` for anything that changes the repository or starts work on it (commit, branch, pull request, issue, onboarding, starting a run), `admin` for the repository's configuration in Lore (settings, webhook, auto-merge). The guard that already sits in front of every repository route compares the level GitHub reports with the level the route needs. A `write` or `admin` action asks GitHub at the time of the action, not from the cache.
- **Things that belong to no repository** (agent definitions, tokens, organisation settings, pools, the audit log, pack sync) need an owner of the GitHub organisation. This replaces "every session is admin".
- **Lore's own scopes stay for callers that are not people.** A person's session no longer carries `admin`; what it may do follows from GitHub.

### 3. Who performs the action: the person decides, the App acts

When a person asks for something that changes a repository, GitHub's answer for that person decides whether it happens. The change itself is still made with the App's installation token, narrowed to that one repository and to the permissions the action needs, and the audit log records the person.

The alternative is to make the change with the person's token, so GitHub attributes the commit to them. It is closer to "GitHub enforces everything", but most of Lore's changes happen later and elsewhere: a station or an agent runs minutes after the click, and would need the person's token handed along and kept valid. Using the App for the act keeps one model for people, agents and scheduled work. This is the choice most worth arguing about.

### 4. Callers that are not people

A token that is not a person's has no GitHub identity to honour. Each such caller gets a credential that can do its one job and nothing else, and none of them is the shared admin token.

| Caller | Today | Proposed |
| --- | --- | --- |
| A repository's CI (ingest, test report, trace impact) | the admin token as a repository secret | GitHub Actions' own OIDC token: the workflow asks GitHub for a signed token that names its repository, and lore-api verifies it and allows ingest for that repository only. No secret is stored in the repository. Where OIDC is not available, a stored token bound to that one repository with only the ingest scopes. |
| Agent pod to the MCP gateway | one bearer for all agents; the gateway then uses the admin token | The run's own short-lived token, which the floor already issues per visit. The gateway checks it, learns the run and its repository, and calls lore-api with a token bound to that repository. An agent can read and write Lore's context for its own repository only. |
| Agent pod to GitHub | an installation token for one repository, 1 hour | unchanged. A run starts only if GitHub says the person who started it has `write`, or if Lore started it itself (a webhook, a schedule). |
| Stations service and its scheduled jobs | the admin token | A named system token with the scopes its sweeps use. It works across repositories by design, never leaves the cluster, and can be rotated on its own. |
| The floor to lore-api | two shared tokens | unchanged in kind: system to system, inside the cluster. |
| The web UI's server | the person's session, plus the App's private key for its own GitHub reads | the person's session only. The UI asks lore-api, which reads GitHub with the person's token. The UI holds no GitHub credential. |
| A developer's laptop (the local MCP server) | the admin token, copied from the cluster into git config | The person signs in from the terminal with the App's device flow and the laptop holds a session for that person. It can do what they can do. |
| GitHub's webhooks to Lore | one signing secret for all repositories, readable through the API | a secret per repository, never served by the API. |
| The static admin token | every caller above | no caller. Kept, if at all, for an operator with `kubectl`. |

### 5. Order of work

1. **The guard and the single question** (written, in review): every repository route asks, and onboarding asks.
2. **Levels**: routes state `read`, `write` or `admin`; the answer still comes from the App asking about the person. Removes the route that serves the webhook secret.
3. **User access tokens**: sign-in through the App, token storage and refresh, lists filtered by GitHub's list, organisation owners for organisation-wide routes. The web UI stops holding the App's key. The OAuth App is retired after one release in which both work.
4. **Callers that are not people**: CI by OIDC, the run-bound gateway credential, the stations token, device-flow sign-in for laptops. The shared admin token is rotated and withdrawn last, when nothing uses it.

Steps 1 and 2 need no change to an install. Step 3 needs the App's callback URL, a client secret and the device flow switched on, and a database migration. Step 4 changes the workflows Lore installs in repositories.

## Rationale

- **GitHub is already the record of who may touch a repository.** A second record in Lore can only be the same or wrong.
- **A removed grant takes effect at once** for anything checked at the time of the action, and within minutes for lists.
- **The sign-in asks for less.** The OAuth App's `repo` scope covers a person's repositories everywhere. The App's token covers only where the App is installed.
- **One leak is one repository.** With the proposed credentials, a workflow's token, an agent's token or a repository secret opens one repository's data in Lore, where today each opens the whole install.

## Consequences

- lore-api holds encrypted GitHub tokens for signed-in people. Its database and the encryption key become more sensitive, and a backup of the table without the key must be useless.
- Each page that lists repositories depends on a recent answer from GitHub. If GitHub cannot be reached, lists come from the cache until it expires and `write` and `admin` actions are refused.
- More calls to GitHub, counted against each person's own rate limit, not the App's.
- A person who is not an owner of the organisation loses the organisation-wide pages they can open today.
- An existing install has to change its GitHub App's settings and its values file once.

## Open Questions

- **Act as the App or as the person** (section 3)?
- **Who counts as an administrator of Lore**: owners of the GitHub organisation only, or also a named GitHub team?
- **GitHub Enterprise Server**: user access tokens and their refresh are documented there. The device flow and Actions OIDC on the versions our installers run have to be confirmed on a real server.
- **Session length**: Lore's session can last 30 days and the refresh token 6 months. Should a session end when a refresh fails, or fall back to read-only?
- **The 5-minute cache** for lists: is a removed grant that still shows a repository's name for up to five minutes acceptable?
- **Encryption key**: generated by the chart like the other tokens, or required from the installer?
