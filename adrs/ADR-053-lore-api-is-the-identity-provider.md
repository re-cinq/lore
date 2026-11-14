---
adr_number: 53
title: "lore-api is the identity provider for the web UI"
status: shipped
date: 2026-10-28
deciders: ["Bogdan Szabo"]
domains: [authentication, lore-api, web-ui, security, infrastructure]
---

# ADR-053: lore-api is the identity provider for the web UI

This ADR records where a person's sign-in lives: lore-api runs the GitHub OAuth dance, checks the org, and mints the session token the web UI sends with every request, so the web UI holds no service token and no OAuth secret.

## Context

The web UI signed people in with NextAuth and a GitHub OAuth app whose callback was the web UI's own host, then called lore-api with one long-lived service token from its environment. lore-api never learned which person acted: an audit row said "admin", and a leaked web UI pod or `.env.local` was full admin on production until someone rotated the token.

The same design made the UI expensive to run against production from a laptop. It needed five secrets, among them the admin token, and an OAuth app of its own whose callback was `http://localhost:3000`, because GitHub only returns a person to a registered address.

## Decision

- **lore-api runs the OAuth dance on its own public host.** The one OAuth app's callback is lore-api's, so one app serves production and every laptop; the UI is only told where to return, and only a page on the configured UI origin or a local UI over http is accepted. ([validated by redirects to github with a state the callback can take once @c428501a](../apps/lore-api/src/transport/routes/auth/login.test.ts#L10))
- **The GitHub token never outlives the callback request.** lore-api trades the code for it, reads the person, their role in the org and the repos they can open, and keeps none of the token. ([validated by sends a member back with a redeem code that carries every repo GitHub shows them @7fade669](../apps/lore-api/src/transport/routes/auth/callback.test.ts#L20))
- **The session is a row in `pipeline.api_tokens`**, kind `user`, valid for eight hours, carrying the person's login, name, avatar and readable repos; every member of the org gets the `admin` scope for now, as the UI's shared admin token gave everyone, until Lore has roles of its own. It is the same bearer token every other client uses, so no second auth path exists. ([validated by stores a user token that expires in eight hours with the person's repos @95cbf1de](../apps/lore-api/src/transport/routes/auth/redeem.test.ts#L65))
- **The UI gets the token through a one-time code**, never in a URL: the callback redirects with a code that `POST /api/auth/redeem` swaps once. ([validated by redeems a code once and answers 401 the second time @639e9826](../apps/lore-api/src/transport/routes/auth/redeem.test.ts#L25))
- **A route that records who acted takes the person from the session** *(added 2026-11-14)*: cancelling a run and running one of its stations by hand record the session's login as `requested_by` and ignore a name in the body, which a person's session need not send; only a service token, which has no person, still says who it acts for, and without a name it is refused `400`. ([validated by records ana as the one who cancelled when her session cancels run r1 with no body @bdcc4607](../apps/lore-api/src/transport/routes/floor/cancel-run.test.ts#L103), [validated by records ana, not the name in the body, when her session cancels a run @40c948b3](../apps/lore-api/src/transport/routes/floor/cancel-run.test.ts#L115), [validated by records ana as the one who ran node review by hand when her session posts no body @f60c5890](../apps/lore-api/src/transport/routes/floor/run-node.test.ts#L97), [validated by answers 400 when a service token posts no requested_by @6ae295a0](../apps/lore-api/src/transport/routes/floor/run-node.test.ts#L131))
- **Repo access is answered by lore-api from the list stored at sign-in**, where the web UI used to ask GitHub with the person's own token on every request. ([validated by answers allowed false for a repo outside the person's list @1e2f1e42](../apps/lore-api/src/transport/routes/auth/session.test.ts#L53))

## Consequences

A web UI run against production needs `LORE_API_URL` and nothing else; no production secret reaches a laptop. Every request lore-api serves for the UI can name the person, so audit rows and `requested_by` fields stop saying "admin".

lore-api is now an identity provider, so a bug there is a bug for every client. It already held the admin token and the GitHub App credentials, which is strictly more power than the sign-in adds.

The repo list is read once at sign-in and lives as long as the token, at most eight hours: access removed on GitHub is honored at the next sign-in, not at the next request. Enforcing repo access inside lore-api's own routes, instead of at the web UI's proxy points, is the follow-up this makes possible, and it now holds for the run routes *(2026-11-14)*: a person's session asking for `/api/assembly-runs/{id}/…`, or its older spelling `/api/assembly-lines/{id}/…`, of a run outside their repositories is refused `403`, a run that does not exist `404`, and a service token passes untouched; a run's repository is read once and kept, an unknown run or a failed read is not, and the oldest answer goes past 5,000 ([validated by refuses Ben the events of a run in a repo outside his list with 403 @ee83635a](../apps/lore-api/src/transport/http/run-repo-guard.test.ts#L62), [validated by answers Ana the events of a run in re-cinq/lore @5793a8de](../apps/lore-api/src/transport/http/run-repo-guard.test.ts#L77), [validated by lets a service token read any run @81c77abe](../apps/lore-api/src/transport/http/run-repo-guard.test.ts#L83), [validated by reads run r1's repo once for five requests @83ad42c5](../apps/lore-api/src/work/auth/run-repo.test.ts#L17), [validated by reads an unknown run again on the next request @415e97a8](../apps/lore-api/src/work/auth/run-repo.test.ts#L33), [validated by reads a run again after its read failed @8cad8f32](../apps/lore-api/src/work/auth/run-repo.test.ts#L43), [validated by drops the oldest answer once more than the cap are kept @24b30bb8](../apps/lore-api/src/work/auth/run-repo.test.ts#L56), [validated by answers 404 to a person asking for an unknown run @a716843f](../apps/lore-api/src/transport/http/run-repo-guard.test.ts#L93), [validated by lets a person list runs without naming one @84ef982c](../apps/lore-api/src/transport/http/run-repo-guard.test.ts#L102), [validated by refuses Ben run r1's nodes under the older /api/assembly-lines spelling with 403 @e1132f59](../apps/lore-api/src/transport/http/run-repo-guard.test.ts#L71)).

The migration is additive in lore-api first (new routes, a new token kind), then the web UI switches over and drops NextAuth, its service-token secrets and the NextAuth secret, and the old OAuth app callback on the UI host is removed.
