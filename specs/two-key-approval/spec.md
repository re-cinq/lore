# Feature Specification: Two-Key Approval PR

| Field       | Value                                                                       |
|-------------|-----------------------------------------------------------------------------|
| Feature     | Two-key CODEOWNERS approval PR                                              |
| Status      | In Progress                                                                 |
| Created     | 2026-06-10                                                                  |
| Owner       | Platform Engineering                                                        |
| Used by     | `POST` / `PUT /api/repos/:owner/:repo/agent-definitions` when a write sets `image`; `PUT /api/repos/:owner/:repo/settings` when a write sets `auto_merge.approver = lore-reviewer` |
| Module      | `apps/lore-api/src/work/two-key/approval-pr.ts` (`verifyApproval`), `apps/lore-api/src/transport/routes/two-key.ts` (`checkApproval`) |

A write that changes what code an agent pod runs, or that installs a second GitHub identity able to approve branch-protected PRs, needs a second key beside the admin token: an open pull request labeled `dark-factory-approval` and approved by an owner of the target repository's `CLAUDE.md`. (The repository-level base image setting — the new `base_image` field on `lore.repos.settings`, written through the repo-settings route — is explicitly excluded from this ceremony; it is authorized by the same admin scope that governs agent-definition writes, requiring no approval PR.)

## Background

This ceremony was written for the dark-factory settings route (`PUT /api/repos/:owner/:repo/settings/dark-factory`, ADR-016), which gated `enabled`, the auto-merge path allowlist and the `require_*` guards behind it. That route and the settings it wrote were deleted on 2026-10-02 with Lore's own Floor, the only reader of those settings (epic #2342). The ceremony stays because agent definitions use it for the `image` field (ADR-025, `specs/lore-agents`), and the protected-branch-merge plan extends it to `auto_merge.approver = lore-reviewer` (see [specs/protected-branch-merge/spec.md](../protected-branch-merge/spec.md)). The label keeps its old name so approval pull requests already open stay valid.

Setting `auto_merge.approver = lore-reviewer` is at least as privileged as changing an agent's `image`: it installs a second GitHub App identity that can satisfy a required-approval branch rule on every Lore-authored PR on that repository. `twoKeyFieldsTouched` covers `auto_merge.approver` alongside `image`; a PUT that changes `auto_merge.approver` to `lore-reviewer` without the `X-Lore-Approval-PR` header is refused `403 { error: "two_key_required" }`. ([validated by returns 403 two_key_required for an auto_merge.approver change to lore-reviewer without the approval header](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L242))

The save path also validates prerequisites before persisting: it confirms that lore-reviewer is installed on the repository and that the branch rule requires one approval, Code Owners review, and the required CI checks; if any prerequisite is missing the response names them and leaves the setting at its current value. ([validated by refuses lore-reviewer with 403 naming the missing Code Owners review and CI checks](apps/lore-api/src/transport/routes/repos/repo-settings.acceptance.test.ts#L121), [validated by names all three gaps for an unprotected branch](apps/lore-api/src/work/repo/auto-merge-approver.test.ts#L33), [validated by returns nothing for one approval, Code Owners review and a build check](apps/lore-api/src/work/repo/auto-merge-approver.test.ts#L29), [validated by reads the rule of the default branch develop](apps/lore-api/src/work/repo/auto-merge-approver.test.ts#L49), [validated by names the installation and ruleset access when the App is absent and the rule read fails](apps/lore-api/src/work/repo/auto-merge-approver.test.ts#L68), [validated by returns 400 for an auto_merge.approver of admin](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L262))

On a change from `lore-reviewer` to `none`, the save path calls `disablePullRequestAutoMerge` on every open Lore-authored PR and writes one `auto_merge_disarmed` audit row per PR (best-effort, after the main transaction commits). ([validated by disarms Lore's armed PR 7, leaves a person's PR 8 armed, and writes one auto_merge_disarmed row when setting none](apps/lore-api/src/transport/routes/repos/repo-settings.acceptance.test.ts#L173), [validated by disarms only Lore's armed PR 1 and writes one audit row for it](apps/lore-api/src/work/repo/auto-merge-approver.test.ts#L87), [validated by writes no audit row for PR 4 when GitHub refuses to disarm it](apps/lore-api/src/work/repo/auto-merge-approver.test.ts#L115), [validated by disarms nothing when Lore runs without an App login](apps/lore-api/src/work/repo/auto-merge-approver.test.ts#L135))

See [specs/protected-branch-merge/plan.md](../protected-branch-merge/plan.md) for the org-admin runbook and failure-edge handling.

## Interface

The caller sends the header `X-Lore-Approval-PR: owner/repo#N` on the write.

A gated write with no `X-Lore-Approval-PR` header is refused `403 { error: "two_key_required", field_paths, detail }`. ([validated by returns 403 two_key_required when the approval header is absent](apps/lore-api/src/transport/routes/two-key.test.ts#L32), [returns 403 two_key_required when the approval header is an empty string](apps/lore-api/src/transport/routes/two-key.test.ts#L52))

A gated write passes with the approval evidence after a passing CODEOWNERS approval. ([validated by returns ok with the approval evidence after a CODEOWNERS approval](apps/lore-api/src/transport/routes/two-key.test.ts#L67))

A failed CODEOWNERS check is refused `403 { error: "codeowners_check_failed", code, detail }`. ([validated by returns 403 codeowners_check_failed on a TwoKeyError](apps/lore-api/src/transport/routes/two-key.test.ts#L88))

A GitHub failure that is not a `TwoKeyError` answers `503 { error: "github_api_unavailable" }`. ([validated by returns 503 github_api_unavailable on a non-TwoKey error](apps/lore-api/src/transport/routes/two-key.test.ts#L111))

## Verification (`verifyApproval`)

1. Parse `prRef` as `owner/repo#N` — malformed → `TwoKeyError(invalid_pr_ref)`.
   ([validated by parses owner/repo#N](apps/lore-api/src/work/two-key/approval-pr.test.ts#L96), [throws invalid_pr_ref on a malformed reference](apps/lore-api/src/work/two-key/approval-pr.test.ts#L100))
2. PR repo must equal `targetRepo` → else `TwoKeyError(wrong_repo)`.
   ([validated by throws wrong_repo when the PR ref targets a different repo](apps/lore-api/src/work/two-key/approval-pr.test.ts#L111))
3. `pulls.get` — 404 → `pr_not_found`; other error → `github_api`.
   ([validated by throws pr_not_found on a 404 from pulls.get](apps/lore-api/src/work/two-key/approval-pr.test.ts#L124), [throws github_api on a non-404 pulls.get failure](apps/lore-api/src/work/two-key/approval-pr.test.ts#L134))
4. PR state must be `open` → else `pr_state`.
   ([validated by throws pr_state when the approval PR is not open](apps/lore-api/src/work/two-key/approval-pr.test.ts#L149))
5. The PR must currently carry the `dark-factory-approval` label → else
   `label_missing`. `issues.listEvents` (paginated) names the label's most recent applier.
   ([validated by throws github_api on a listEvents failure](apps/lore-api/src/work/two-key/approval-pr.test.ts#L162), [throws label_missing when no labeled event carries the approval label](apps/lore-api/src/work/two-key/approval-pr.test.ts#L177), [throws label_missing when the labeled event carries no actor login](apps/lore-api/src/work/two-key/approval-pr.test.ts#L192))
6. Fetch CODEOWNERS (`.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS` in
   order). The approver is that applier when they own `CLAUDE.md`, otherwise a
   `CLAUDE.md` owner whose latest decisive review (`pulls.listReviews`, paginated;
   a later changes-requested or dismissed review cancels an approval) is APPROVED;
   neither → `approver_not_codeowner` (or `team_membership_unresolved` when
   `CLAUDE.md` is owned only through `@org/team` handles).
   ([validated by throws approver_not_codeowner when CODEOWNERS mixes user and team handles](apps/lore-api/src/work/two-key/approval-pr.test.ts#L222), [throws approver_not_codeowner when CODEOWNERS is empty](apps/lore-api/src/work/two-key/approval-pr.test.ts#L238), [throws team_membership_unresolved when CODEOWNERS lists only team handles](apps/lore-api/src/work/two-key/approval-pr.test.ts#L254), [matches a login against a bare or @-prefixed handle](apps/lore-api/src/work/two-key/approval-pr.test.ts#L492))
7. Success → `{ prRef, approver, prUrl }`.
   ([validated by resolves with evidence when the approver is a direct CODEOWNERS handle](apps/lore-api/src/work/two-key/approval-pr.test.ts#L207))

The approval is a live decision by an owner of the repository's `CLAUDE.md` *(added 2026-10-11, #2356)*. A label that was applied and later removed approves nothing; the applier and the reviews are read across every page. The approver must own `CLAUDE.md` itself: the owners of the last CODEOWNERS rule matching that path, the way GitHub resolves it, so a handle that owns only another path, or a rule that later unowns `CLAUDE.md`, does not qualify; handles compare without case. Binding one approval PR to the specific write it approves is not enforced and needs a product decision (#2356). ([validated by refuses an approval whose label was removed after it was applied](apps/lore-api/src/work/two-key/approval-pr.test.ts#L270), [refuses when the events log still shows a labeling but the PR no longer carries the label](apps/lore-api/src/work/two-key/approval-pr.test.ts#L282), [attributes the approval to the owner who relabeled after a non-owner's label was removed](apps/lore-api/src/work/two-key/approval-pr.test.ts#L294), [refuses a labeler who owns another path but not CLAUDE.md](apps/lore-api/src/work/two-key/approval-pr.test.ts#L307), [accepts the CLAUDE.md owner with the label present](apps/lore-api/src/work/two-key/approval-pr.test.ts#L318), [lets the last matching rule win over an earlier broader one](apps/lore-api/src/work/two-key/approval-pr.test.ts#L327), [lets a later broad rule override an earlier CLAUDE.md rule](apps/lore-api/src/work/two-key/approval-pr.test.ts#L338), [treats a later rule with no owners as unowning CLAUDE.md](apps/lore-api/src/work/two-key/approval-pr.test.ts#L349), [does not match CLAUDE.md against a rule for another file or a directory](apps/lore-api/src/work/two-key/approval-pr.test.ts#L360), [refuses with team_membership_unresolved when only a team owns CLAUDE.md](apps/lore-api/src/work/two-key/approval-pr.test.ts#L370), [matches handles case-insensitively](apps/lore-api/src/work/two-key/approval-pr.test.ts#L381), [reads past the first page of events](apps/lore-api/src/work/two-key/approval-pr.test.ts#L390), [accepts an owner's APPROVED review when a non-owner applied the label](apps/lore-api/src/work/two-key/approval-pr.test.ts#L405), [refuses an owner approval later withdrawn by CHANGES_REQUESTED](apps/lore-api/src/work/two-key/approval-pr.test.ts#L415), [refuses an owner approval that was DISMISSED](apps/lore-api/src/work/two-key/approval-pr.test.ts#L429), [refuses an owner approval when the label has been removed](apps/lore-api/src/work/two-key/approval-pr.test.ts#L441), [refuses an APPROVED review from a non-owner](apps/lore-api/src/work/two-key/approval-pr.test.ts#L454), [keeps an owner approval standing through a later plain comment](apps/lore-api/src/work/two-key/approval-pr.test.ts#L466), [reads reviews across pages](apps/lore-api/src/work/two-key/approval-pr.test.ts#L476))
