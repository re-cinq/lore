# Definition of Done

> Floor git-credential provider mints all-permission installation tokens for any installed repo on one static shared bearer, ignoring `access`, with no audit or rotation window

**Strategy: `direct`** — The `handleFloorGitCredential` function is already the seam for git credential minting. We can test rotation, onboarding refusal, and auditing directly through its dependencies.

## Done when these pass

- [x] **answers 200 when the bearer matches any token in a comma-separated list** — validates that rotation needs no downtime
  `apps/lore-api/src/transport/routes/floor/git-credential.test.ts`
- [x] **answers 403 and mints nothing when the repo is not onboarded** — validates refusing unonboarded repos
  `apps/lore-api/src/transport/routes/floor/git-credential.test.ts`
- [x] **writes an audit log entry for the mint** — validates that mints are audited
  `apps/lore-api/src/transport/routes/floor/git-credential.test.ts`

## Facets

- [x] Support comma-separated tokens in `checkBearer`
- [x] Inject a repo-onboarded check into `FloorGitCredentialDeps` and return 403 if false
- [x] Inject an audit sink into `FloorGitCredentialDeps` and call it on successful mint

## Out of scope

- Moving `secrets:write` and `repository_hooks:write` into a separate onboarding-only App
- Forwarding the visit id and run token from the floor (the "Better still" suggestion)
