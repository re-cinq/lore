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

- **lore-api runs the OAuth dance on its own public host.** The one OAuth app's callback is lore-api's, so one app serves production and every laptop; the UI is only told where to return, and only a page on the configured UI origin or a local UI over http is accepted. ([validated by redirects to github with a state the callback can take once](../apps/lore-api/src/transport/routes/auth/login.test.ts#L10))
- **The GitHub token never outlives the callback request.** lore-api trades the code for it, reads the person, their role in the org and the repos they can open, and keeps none of the token. ([validated by sends a member back with a redeem code that carries every repo GitHub shows them](../apps/lore-api/src/transport/routes/auth/callback.test.ts#L20))
- **The session is a row in `pipeline.api_tokens`**, kind `user`, valid for eight hours, carrying the person's login, name, avatar and readable repos; every member of the org gets the `admin` scope for now, as the UI's shared admin token gave everyone, until Lore has roles of its own. It is the same bearer token every other client uses, so no second auth path exists. ([validated by stores a user token that expires in eight hours with the person's repos](../apps/lore-api/src/transport/routes/auth/redeem.test.ts#L65))
- **The UI gets the token through a one-time code**, never in a URL: the callback redirects with a code that `POST /api/auth/redeem` swaps once. ([validated by redeems a code once and answers 401 the second time](../apps/lore-api/src/transport/routes/auth/redeem.test.ts#L25))
- **Repo access is answered by lore-api from the list stored at sign-in**, where the web UI used to ask GitHub with the person's own token on every request. ([validated by answers allowed false for a repo outside the person's list](../apps/lore-api/src/transport/routes/auth/session.test.ts#L53))

## Consequences

A web UI run against production needs `LORE_API_URL` and nothing else; no production secret reaches a laptop. Every request lore-api serves for the UI can name the person, so audit rows and `requested_by` fields stop saying "admin".

lore-api is now an identity provider, so a bug there is a bug for every client. It already held the admin token and the GitHub App credentials, which is strictly more power than the sign-in adds.

The repo list is read once at sign-in and lives as long as the token, at most eight hours: access removed on GitHub is honored at the next sign-in, not at the next request. Enforcing repo access inside lore-api's own routes, instead of at the web UI's proxy points, is the follow-up this makes possible.

The migration is additive in lore-api first (new routes, a new token kind), then the web UI switches over and drops NextAuth, its service-token secrets and the NextAuth secret, and the old OAuth app callback on the UI host is removed.
