# Definition of Done

> Turning auto_merge.approver on is two-key (admin scope plus a CODEOWNER approval PR), which needs a CODEOWNERS file covering CLAUDE.md.

**Strategy: `direct`** — The `PUT /api/repos/{owner}/{repo}/settings` route already exists; the acceptance test directly calls it to ensure the two-key gate is enforced when setting `auto_merge.approver` to `lore-reviewer`.

## Done when these pass

- [ ] **returns 403 two_key_required for an auto_merge.approver change to lore-reviewer without the approval header** — refuses the settings patch if the approval header is missing
  `apps/lore-api/src/transport/routes/repos/repo-settings.test.ts`

## Facets

- [ ] Add `auto_merge` and `approver` to `RepoSettingsSchema`
- [ ] Add `twoKeyFieldsTouched` or equivalent logic to detect the change
- [ ] Apply the `checkApproval` gate to the repo settings route

## Out of scope

- Testing the CODEOWNERS logic (already tested in `two-key.test.ts`)
- Actually modifying GitHub branch protection rules