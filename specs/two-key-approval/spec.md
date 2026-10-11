# Feature Specification: Two-Key Approval PR

| Field       | Value                                                                       |
|-------------|-----------------------------------------------------------------------------|
| Feature     | Two-key CODEOWNERS approval PR                                              |
| Status      | In Progress                                                                 |
| Created     | 2026-06-10                                                                  |
| Owner       | Platform Engineering                                                        |
| Used by     | `POST` / `PUT /api/repos/:owner/:repo/agent-definitions` when a write sets `image`; `PUT /api/repos/:owner/:repo/settings` when a write sets `auto_merge.approver = lore-reviewer` |
| Module      | `apps/lore-api/src/work/two-key/approval-pr.ts` (`verifyApproval`), `apps/lore-api/src/transport/routes/two-key.ts` (`checkApproval`) |

A write that changes what code an agent pod runs, or that installs a second GitHub identity able to approve branch-protected PRs, needs a second key beside the admin token: an open pull request labeled `dark-factory-approval` by a CODEOWNER of the target repository.

## Background

This ceremony was written for the dark-factory settings route (`PUT /api/repos/:owner/:repo/settings/dark-factory`, ADR-016), which gated `enabled`, the auto-merge path allowlist and the `require_*` guards behind it. That route and the settings it wrote were deleted on 2026-10-02 with Lore's own Floor, the only reader of those settings (epic #2342). The ceremony stays because agent definitions use it for the `image` field (ADR-025, `specs/lore-agents`), and the protected-branch-merge plan extends it to `auto_merge.approver = lore-reviewer` (see [specs/protected-branch-merge/spec.md](../protected-branch-merge/spec.md)). The label keeps its old name so approval pull requests already open stay valid.

Setting `auto_merge.approver = lore-reviewer` is at least as privileged as changing an agent's `image`: it installs a second GitHub App identity that can satisfy a required-approval branch rule on every Lore-authored PR on that repository. `twoKeyFieldsTouched` covers `auto_merge.approver` alongside `image`; a PUT that changes `auto_merge.approver` to `lore-reviewer` without the `X-Lore-Approval-PR` header is refused `403 { error: "two_key_required" }`. The save path also validates prerequisites before persisting: it confirms that lore-reviewer is installed on the repository and that the branch rule requires one approval, Code Owners review, and the required CI checks; if any prerequisite is missing the response names them and leaves the setting at its current value. On a change from `lore-reviewer` to `none`, the save path calls `disablePullRequestAutoMerge` on every open Lore-authored PR and writes one `auto_merge_disarmed` audit row per PR (best-effort, after the main transaction commits). See [specs/protected-branch-merge/plan.md](../protected-branch-merge/plan.md) for the org-admin runbook and failure-edge handling.

## Interface

The caller sends the header `X-Lore-Approval-PR: owner/repo#N` on the write.

A gated write with no `X-Lore-Approval-PR` header is refused `403 { error: "two_key_required", field_paths, detail }`. ([validated by returns 403 two_key_required when the approval header is absent](apps/lore-api/src/transport/routes/two-key.test.ts#L32), [returns 403 two_key_required when the approval header is an empty string](apps/lore-api/src/transport/routes/two-key.test.ts#L52))

A gated write passes with the approval evidence after a passing CODEOWNERS approval. ([validated by returns ok with the approval evidence after a CODEOWNERS approval](apps/lore-api/src/transport/routes/two-key.test.ts#L67))

A failed CODEOWNERS check is refused `403 { error: "codeowners_check_failed", code, detail }`. ([validated by returns 403 codeowners_check_failed on a TwoKeyError](apps/lore-api/src/transport/routes/two-key.test.ts#L88))

A GitHub failure that is not a `TwoKeyError` answers `503 { error: "github_api_unavailable" }`. ([validated by returns 503 github_api_unavailable on a non-TwoKey error](apps/lore-api/src/transport/routes/two-key.test.ts#L111))

## Verification (`verifyApproval`)

1. Parse `prRef` as `owner/repo#N` — malformed → `TwoKeyError(invalid_pr_ref)`.
   ([validated by parses owner/repo#N](apps/lore-api/src/work/two-key/approval-pr.test.ts#L63), [throws invalid_pr_ref on a malformed reference](apps/lore-api/src/work/two-key/approval-pr.test.ts#L67))
2. PR repo must equal `targetRepo` → else `TwoKeyError(wrong_repo)`.
   ([validated by throws wrong_repo when the PR ref targets a different repo](apps/lore-api/src/work/two-key/approval-pr.test.ts#L78))
3. `pulls.get` — 404 → `pr_not_found`; other error → `github_api`.
   ([validated by throws pr_not_found on a 404 from pulls.get](apps/lore-api/src/work/two-key/approval-pr.test.ts#L91), [throws github_api on a non-404 pulls.get failure](apps/lore-api/src/work/two-key/approval-pr.test.ts#L101))
4. PR state must be `open` → else `pr_state`.
   ([validated by throws pr_state when the approval PR is not open](apps/lore-api/src/work/two-key/approval-pr.test.ts#L116))
5. `issues.listEvents` → find the `labeled` event whose label is
   `dark-factory-approval`; none → `label_missing`. `approver = event.actor.login`.
   ([validated by throws github_api on a listEvents failure](apps/lore-api/src/work/two-key/approval-pr.test.ts#L129), [throws label_missing when no labeled event carries the approval label](apps/lore-api/src/work/two-key/approval-pr.test.ts#L144), [throws label_missing when the labeled event carries no actor login](apps/lore-api/src/work/two-key/approval-pr.test.ts#L159))
6. Fetch CODEOWNERS (`.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS` in
   order). `isCodeowner(approver, …)` must be true; else `approver_not_codeowner`
   (or `team_membership_unresolved` when CODEOWNERS lists only `@org/team`
   handles).
   ([validated by throws approver_not_codeowner when CODEOWNERS mixes user and team handles](apps/lore-api/src/work/two-key/approval-pr.test.ts#L189), [throws approver_not_codeowner when CODEOWNERS is empty](apps/lore-api/src/work/two-key/approval-pr.test.ts#L205), [throws team_membership_unresolved when CODEOWNERS lists only team handles](apps/lore-api/src/work/two-key/approval-pr.test.ts#L221), [matches a login against a bare or @-prefixed handle](apps/lore-api/src/work/two-key/approval-pr.test.ts#L237))
7. Success → `{ prRef, approver, prUrl }`.
   ([validated by resolves with evidence when the approver is a direct CODEOWNERS handle](apps/lore-api/src/work/two-key/approval-pr.test.ts#L174))
