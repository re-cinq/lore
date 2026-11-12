# Definition of Done

> Human reconciliation of the original GitHub-specific criterion with ADR-053/lore-api access semantics; retain the authorization gate and deadline.

**Strategy: `mechanical`** — This is a spec correction to reconcile the original GitHub access criterion with the current lore-api allow-list contract. The existing code already implements this and existing tests pin the behaviour.

## Done when these pass

- [ ] **user-repo-access** — returns true when lore-api says the repo is in the person's list, and false when it is not, when lore-api refuses the token or when it is not configured.
  `apps/web-ui/src/lib/user-repo-access.test.ts`
- [ ] **user-repo-access deadline** — gives the access question a deadline so a hung lore-api cannot pin the proxy routes
  `apps/web-ui/src/lib/api/auth.test.ts`

## Facets

- [x] Update `specs/shared-utilities/spec.md` to state explicitly that `user-repo-access` supersedes direct GitHub access checks per ADR-053.

## Out of scope

- Behavioral changes to `user-repo-access` or its deadline logic, as these are already implemented correctly.
