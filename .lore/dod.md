# Definition of Done

> A session whose access token has expired keeps working without a new sign-in while its refresh token is valid. It ends when GitHub refuses the refresh token and after any refresh that was sent and did not come back with a new pair, a server error included; it is kept only when the refresh request never left lore-api.

**Strategy: `direct`** — `buildServer`, `freshAccessToken`, `refreshedRepos`, and `personGithubEnv` already expose the full HTTP sign-in, token-refresh, and session-termination seams against PostgreSQL and `globalThis.fetch`.

The red/green bar is CI's to show because PostgreSQL is not running in this pod; the CI job that runs these tests is `Integration Tests / integration` (`.github/workflows/test-integration.yml`, step `Run integration tests`).

## Done when these pass

- [ ] **keeps an expired session working across its callers without a new sign-in while its refresh token is valid** — proves an expired access token refreshes seamlessly across both `GET /api/repos/{owner}/{repo}/github/file` (`actingEnv` -> `personGithubEnv`) and `GET /api/repos` (`refreshedRepos`) against real PostgreSQL
  `apps/lore-api/src/integration-tests/session-refresh-sc016.acceptance.test.ts`
- [ ] **ends the session, deletes stored tokens, closes open live sockets, and refuses later requests with 401 when GitHub refuses the refresh token** — proves `bad_refresh_token` revokes the session row, deletes `pipeline.user_session_tokens`, closes open `/api/ws` sockets, and rejects subsequent requests with 401
  `apps/lore-api/src/integration-tests/session-refresh-sc016.acceptance.test.ts`
- [ ] **ends the session, deletes stored tokens, closes open live sockets, and refuses later requests with 401 after a sent refresh gets %s** — proves `5xx`, `timeout`, and `incomplete-2xx` sent refreshes end the session, delete stored tokens, close live sockets, and reject subsequent requests with 401
  `apps/lore-api/src/integration-tests/session-refresh-sc016.acceptance.test.ts`
- [ ] **keeps the session and stored tokens when the refresh request never left lore-api and refreshes on the next request once GitHub is reachable** — proves `ECONNREFUSED` keeps `revoked_at` null, preserves `pipeline.user_session_tokens`, keeps `/api/ws` alive, and rotates on the next request once GitHub is reachable
  `apps/lore-api/src/integration-tests/session-refresh-sc016.acceptance.test.ts`

## Facets

- [ ] Run `apps/lore-api/src/integration-tests/session-refresh-sc016.acceptance.test.ts` against CI's PostgreSQL in `Integration Tests / integration` and fix any real-DB or caller integration failure it surfaces
- [ ] Verify the `SC-016` links in `specs/github-decides-repo-access/spec.md` resolve and pass `pr-checks` + `test-integration`

## Out of scope

- The refreshing mark and deadline rules (`FR-393`, `FR-440`, `FR-441`, `FR-442`, `FR-397`, tracked separately in #58)
- Other success criteria from #79 (`SC-018`, `SC-021`, `SC-022`, `SC-023`, etc.)
