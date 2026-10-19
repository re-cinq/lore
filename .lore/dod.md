# Definition of Done

> The ceremony resolves approvers from CODEOWNERS entries that name people, so the file must list at least one `@user` handle beside the team handles or the ceremony refuses with team_membership_unresolved; this repo’s file, team handles only, needs that line before the ceremony can run here.

**Strategy: `mechanical`** — The `auto_merge.approver` code logic and its two-key gate were already implemented on this branch with acceptance tests added. The only remaining part of the ticket is the mechanical addition of an `@user` handle to CODEOWNERS to satisfy the two-key ceremony. The red bar is CI's to show; the `lore-tests` CI job runs the tests.

## Done when these pass

- [x] **returns 403 two_key_required for an auto_merge.approver change to lore-reviewer without the approval header** — refuses the settings patch if the approval header is missing
  `apps/lore-api/src/transport/routes/repos/repo-settings.test.ts`

## Facets

- [x] Add `@lore-admin` user to `/CLAUDE.md` in `CODEOWNERS`

## Out of scope

- Agent execution images (already removed in dark factory cleanup).
