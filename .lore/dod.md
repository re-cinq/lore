# Definition of Done

> Agent pods get GitHub tokens with every lore-agent App permission (workflows, secrets, hooks, checks write); only the repo is narrowed

**Strategy: `direct`** — The seam already exists. `getInstallationToken` is directly callable with a mocked octokit that records auth calls, and `handleFloorGitCredential` accepts an injectable `mint` function whose arguments are observable.

## Done when these pass

- [ ] **getInstallationToken includes permissions in the auth call** — when a permissions map is supplied, `ok.auth` receives a `permissions` field so the minted token carries only the specified scopes instead of the full App grant
  `libs/shared/src/outbound/project/lib/platform-github.test.ts`

- [ ] **handleFloorGitCredential passes access to mint** — the `access` value from the request body is forwarded to `mint` as a second argument so the minter can choose read-only or minimum-write permissions; currently `mint` is called as `mint(repo)` only, and the captured `access` is `undefined`
  `apps/lore-api/src/transport/routes/floor/git-credential.test.ts`

## Facets

- [ ] Add an optional `permissions` parameter to `getInstallationToken` in `libs/shared/src/outbound/project/lib/platform-github.ts` and pass it to `ok.auth`
- [ ] Update `FloorGitCredentialDeps.mint` signature to `(repo: string, access: "read" | "write") => Promise<string>` and have `handleFloorGitCredential` call `mint(repo, body.access)`
- [ ] Update `serveFloorGitCredential` to map `access` to a permissions object (`read` → `{contents:"read",metadata:"read"}`, `write` → `{contents:"write",pull_requests:"write",issues:"write",metadata:"read"}`) and pass it to `getInstallationToken`

## Out of scope

- The Floor's own client token (the ticket notes it keeps the full set for onboarding hooks and secrets)
- Secrets write, repository_hooks write, workflows write, checks write — removing these from the App registration itself is a longer-term follow-up named in the ticket
- Repo scoping (already fixed per ticket, closes #1484)
- Rotation window and audit logging for the floor git-credential broker (second half of the ticket's second finding)
- Moving secrets:write and repository_hooks:write to a separate onboarding-only App (ticket's "longer term" note)
