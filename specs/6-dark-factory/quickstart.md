# Quickstart: Dark Factory Mode verification

Maps each spec scenario to a concrete verification procedure. Run after
Phase 5 deploy on a pilot repo. Each scenario corresponds 1:1 to a
`## User Scenarios & Acceptance Criteria` entry in `spec.md` and to one
or more success criteria.

---

## Pre-flight

### 1 — Verify both gates are on

Dark-factory mode requires **two independent gates**:

| Gate | Where | How to check |
|------|-------|--------------|
| Per-repo `dark_factory.enabled = true` | `lore.repos.settings` | `GET $LORE_API_URL/api/repos/$REPO/settings/dark-factory` |
| Cluster `LORE_DARK_FACTORY_CLUSTER_ENABLED=true` | Agent deployment env | `kubectl get deployment lore-agent -n lore-agent -o jsonpath='{.spec.template.spec.containers[0].env}'` |

If the cluster gate is off, impl/general/review tasks fall back to the
legacy `claude --print` path even when per-repo dark mode is on. Gap-fill
and runbook flows (which run entirely in-agent, not as Job pods) are not
affected by the cluster gate.

```bash
export REPO=re-cinq/test-darkmode
export LORE_API_URL=https://lore-api.example.com
export LORE_TOKEN=<admin-scoped token>

# Check current settings (no auth required for GET).
curl -s "$LORE_API_URL/api/repos/$REPO/settings/dark-factory" | jq
```

### 2 — Run the two-key ceremony

Privileged fields (`enabled`, `auto_merge.paths`, lowering
`require_green_ci`/`require_bot_approval`) require admin scope **plus**
an open PR on the target repo whose `dark-factory-approval` label was
applied by a CODEOWNER of that repo's `CLAUDE.md`.

```bash
# Step 1: Anyone creates the approval PR (it is just a ceremony record;
# the PR itself need not contain meaningful changes).
gh pr create -R $REPO \
  --title "dark-factory: enable for $REPO" \
  --body "Ceremony PR for dark-factory enablement. Close after settings are applied."
# Note the PR number — call it N.

# Step 2: A CODEOWNER adds the label **as a separate action after the PR
# is open**. The audit check looks for a labeled event with an actor, so
# adding the label via --label at creation time does NOT count.
gh pr edit N -R $REPO --add-label dark-factory-approval
# The actor who runs this command must appear in $REPO's CODEOWNERS file
# as a direct @user handle. Team handles (@org/team) are not resolved
# in v1 — see "Known v1 limitations" below.

# Step 3: PUT the settings using the admin token, referencing the open PR.
curl -X PUT "$LORE_API_URL/api/repos/$REPO/settings/dark-factory" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Lore-Approval-PR: $REPO#N" \
  -d '{"enabled": true}'
# Expected: 200 with the fully-resolved settings object.
```

#### Two-key error codes

If the PUT fails with `403 two_key_required`, the `code` field in the
response body identifies the reason:

| Code | Meaning | Fix |
|------|---------|-----|
| `missing_header` | `X-Lore-Approval-PR` header absent | Add the header |
| `invalid_pr_ref` | Header not `owner/repo#N` format | Check format |
| `pr_not_found` | PR doesn't exist | Check PR number + repo |
| `pr_state` | PR is closed/merged | Reopen or create a new PR |
| `label_missing` | `dark-factory-approval` label not on the PR | Have a CODEOWNER add it |
| `approver_not_codeowner` | Label was applied by someone not in CODEOWNERS | Use a CODEOWNER's login |
| `team_membership_unresolved` | CODEOWNERS has only `@org/team` handles | Add a direct `@user` for the approver (v1 limitation) |
| `wrong_repo` | Approval PR is against a different repo | PR must be on `$REPO` |

---

## Scenario A: Routine doc PR auto-merges (Spec Scenario 1, SC3, SC6)

Gap-fill tasks are created internally by the `gap-detect` job (not by a
GitHub Actions workflow). Trigger it directly via the pipeline API:

```bash
# 1. Create a gap-fill task for the pilot repo.
curl -X POST "$LORE_API_URL/api/tasks" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"gap-fill\",\"target_repo\":\"$REPO\",\"description\":\"Fill missing ADR documentation\"}"
# Note the returned task UUID.
TASK_UUID=<uuid from response>

# 2. Watch the supervisor walk the gap-fill workflow graph.
#    Expected stages in order: draft → validate → push → retrospective → done
watch -n 10 "git fetch origin && git log origin/lore/gap-fill/... --pretty=format:'%H %s%n%b' | grep 'Lore-Stage:'"

# 3. Once the supervisor pod exits (exit 0), the loretask-watcher creates the PR.
gh pr list -R $REPO --search "author:app/lore-agent" --limit 1 --json number,state,title,body

# 4. Verify auto-merge: the PR should merge automatically on green CI
#    (loretask-watcher calls tryAutoMergeForCompletedTask after PR creation;
#    a webhook re-fires when CI completes).
# Expected: state=MERGED, body contains "Lore-Task: <uuid>".

# 5. Confirm no GitHub Issue was created.
gh issue list -R $REPO --label lore-managed --search "$TASK_UUID"
# Expected: empty.

# 6. Inspect commit trailers on the merged branch.
git fetch origin
git log origin/lore/gap-fill/... --pretty=format:"%H %s%n%b" | grep "Lore-Stage:"
# Expected: Lore-Stage: draft, then validate, then push, then retrospective.

# 7. Check the auto-merge audit log entry.
psql $LORE_DB -c "
  SELECT payload->'outcome', payload->'rule'
  FROM pipeline.audit_log
  WHERE event_type='auto_merge_decision' AND task_id='$TASK_UUID'"
# Expected: outcome="merged", rule has path_match_count > 0, ci_status="success",
#           bot_review_state="APPROVED".
```

**Pass:** PR merged ≤ 24 h, no Issue exists, stages `draft → validate →
push → retrospective` present, audit log entry records the merge rule.

---

## Scenario B: Implementation task survives pod death (Spec Scenario 2, SC2)

```bash
# 1. Create an implementation task.
curl -X POST "$LORE_API_URL/api/tasks" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"implementation\",\"target_repo\":\"$REPO\",\"description\":\"Add a no-op test fixture\"}"
TASK_UUID=<uuid>

# 2. Watch for the [implement] and [validate] stage commits to land.
watch -n 5 "git fetch origin && git log origin/lore/feature/... --pretty=format:'%H %s' | head -5"

# 3. After both commits exist, kill the running Job pod.
POD=$(kubectl get pods -n lore-agent -l task-id=$TASK_UUID -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod -n lore-agent $POD

# 4. The lease TTL is 10 minutes; the reaper runs every 60 s and deletes
#    leases more than 5 min past expiry. A new Job pod spawns after the
#    LoreTask controller detects the failure and retries.
#    Wait up to 15 min for the replacement pod to start and take over.

# 5. Verify the replacement resumed from the correct stage.
git fetch origin
git log origin/lore/feature/... --pretty=format:"%H %s%n%b" | grep "Lore-Stage:"
# Expected: implement, validate, push, review, retrospective — no duplicates.

# 6. Inspect the lease takeover in the audit log.
psql $LORE_DB -c "
  SELECT event_type, payload
  FROM pipeline.audit_log
  WHERE task_id='$TASK_UUID'
  ORDER BY created_at"
# Expected: one lease_expired entry naming the previous pod's holder,
#           followed by the subsequent stage entries.
```

**Pass:** Final PR has the unbroken stage sequence, no phase
re-executed, audit log shows the takeover.

---

## Scenario C: Code change requires human review (Spec Scenario 3, SC6)

```bash
# 1. Create a general task that edits files outside the auto-merge allowlist.
curl -X POST "$LORE_API_URL/api/tasks" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"general\",\"target_repo\":\"$REPO\",\"description\":\"Refactor X in agent/src/foo.ts\"}"
TASK_UUID=<uuid>

# 2. Wait for the PR to appear.
gh pr list -R $REPO --search "author:app/lore-agent" --limit 1 --json number,state

# 3. Confirm it is NOT auto-merged.
# Expected: state=OPEN, bot review comments present.

# 4. Inspect the auto-merge deferral in the audit log.
psql $LORE_DB -c "
  SELECT payload->'outcome', payload->'rule'
  FROM pipeline.audit_log
  WHERE event_type='auto_merge_decision' AND task_id='$TASK_UUID'"
# Expected: outcome="deferred:path_outside_allowlist".

# Note: if the task produced zero file changes, the outcome will be
# "deferred:no_changes" instead (vacuous-truth guard in the engine).
```

**Pass:** PR open, audit log explains the deferral, bot review comments
visible.

---

## Scenario D: Approval gate produces an Issue (Spec Scenario 4)

```bash
# 1. Create a task with the approval flag set.
curl -X POST "$LORE_API_URL/api/tasks" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"general\",\"target_repo\":\"$REPO\",\"description\":\"Add infra change\",\"dark_factory_overrides\":{\"with_issue\":true}}"
TASK_UUID=<uuid>
# Alternatively, if the task type has approval_required:true in task-types.yaml,
# no override is needed.

# 2. Verify an Issue is created.
gh issue list -R $REPO --label lore-managed --search "$TASK_UUID"
# Expected: one Issue with task description and approval instructions.

# 3. Confirm no commits on the candidate branch yet.
git ls-remote origin "refs/heads/lore/general/*"
# Expected: no matching refs.

# 4. Apply the approval label.
ISSUE_NUM=<issue number from step 2>
gh issue edit $ISSUE_NUM -R $REPO --add-label approved

# 5. Wait for supervisor to start. Branch commits should appear within 5 min.
watch -n 10 "git fetch origin && git log origin/lore/general/... --pretty=oneline | head -3"
```

**Pass:** Issue exists before any commits, no work begins until label
applied, after label the workflow proceeds normally.

---

## Scenario E: Escalation produces an Issue with full context (Spec Scenario 5)

```bash
# 1. Create an implementation task that will fail validation (e.g. a
#    deliberate TypeScript syntax error in the description/spec).
curl -X POST "$LORE_API_URL/api/tasks" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"implementation\",\"target_repo\":\"$REPO\",\"description\":\"Introduce intentional TypeScript error for escalation test\"}"
TASK_UUID=<uuid>

# 2. The implementation workflow allows 1 implement→implement retry and
#    1 validate→implement retry (iteration_max=1 on each back-edge).
#    Two consecutive validate failures exhaust the budget and trigger
#    IterationMaxExceededError (runner-cli exits with code 6).
#    The loretask-watcher detects exit 6 and calls escalate().

# 3. Verify escalation Issue.
gh issue list -R $REPO --label needs-human-help
# Expected: one Issue containing:
#   - task description
#   - branch link (carries partial work)
#   - failing validation output
#   - supervisor diagnostic
#   - links to contributing facts/memories

# 4. Verify the branch carries partial work.
git fetch origin
git log origin/lore/feature/... --pretty=format:"%H %s" | head -10
# Expected: stage commits up to and including the failed validate(s).

# 5. Confirm Slack escalation notification (if notify is configured).
# Check the Slack channel wired to the repo's notify settings.
```

**Pass:** Issue exists with diagnostic content, Slack message fired (if
configured), branch carries partial work, task status `needs-human-help`.

---

## Scenario F: Repo opts out of dark mode (Spec Scenario 6)

```bash
# 1. Set dark_factory.enabled = false (the migration default for all repos).
#    This change to `enabled` also requires the two-key ceremony.
curl -X PUT "$LORE_API_URL/api/repos/$REPO/settings/dark-factory" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Lore-Approval-PR: $REPO#N" \
  -d '{"enabled": false}'

# 2. Trigger any task type.
curl -X POST "$LORE_API_URL/api/tasks" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"gap-fill\",\"target_repo\":\"$REPO\",\"description\":\"Test opt-out behavior\"}"
TASK_UUID=<uuid>

# 3. Verify legacy behavior: Issue created, status comments posted,
#    no auto-merge, every PR awaits human review.
gh issue list -R $REPO --label lore-managed --search "$TASK_UUID"
# Expected: one Issue per task as before.

# 4. Verify trailers are still present (unconditional per FR1.1 / Q5).
git fetch origin
git log origin/lore/gap-fill/... --pretty=format:"%b" | grep "Lore-Stage:"
# Expected: stages present even though dark mode is off.

# 5. Confirm auto-merge was not attempted (or was deferred:dark_mode_off).
psql $LORE_DB -c "
  SELECT payload->'outcome'
  FROM pipeline.audit_log
  WHERE event_type='auto_merge_decision' AND task_id='$TASK_UUID'"
# Expected: outcome="deferred:dark_mode_off" or no row (auto-merge engine
# skips repos with darkFactoryEnabled=false before writing the audit entry).
```

**Pass:** Behavior matches pre-feature for opt-out repos; trailers still
emitted.

---

## Scenario G: PR-to-task cross-reference without Issues (Spec Scenario 7, SC5)

```bash
# 1. Open a merged PR from Scenario A in the web-ui.
#    The /api/tasks/by-pr/:o/:r/:n route resolves the PR to the task UUID.
PR_NUM=<PR number from Scenario A>
open "$LORE_UI_URL/pipeline/by-pr/$REPO/$PR_NUM"
# Expected: web-ui resolves the Lore-Task: trailer and renders the
#           stage timeline with node-type icons, outcome badges, and
#           lease indicator.

# 2. Verify the reverse direction from the task page.
open "$LORE_UI_URL/pipeline/$TASK_UUID"
# Expected: shows branch, stage timeline, retrospective episode, link to PR.

# 3. Verify via the API directly.
OWNER=$(echo $REPO | cut -d/ -f1)
REPO_NAME=$(echo $REPO | cut -d/ -f2)
curl -s "$LORE_API_URL/api/tasks/by-pr/$OWNER/$REPO_NAME/$PR_NUM" | jq .id
# Expected: the task UUID.
```

**Pass:** Both directions resolve in one click; timeline shows all
stages with durations and outcomes.

---

## Success criteria mapping

| Scenario | Success criteria covered |
|----------|--------------------------|
| A | SC3, SC4, SC6, SC7 |
| B | SC2, SC5 |
| C | SC6, SC7 |
| D | SC4 (approval-gated Issue creation preserved) |
| E | SC4, SC5 |
| F | SC5 (audit completeness on opt-out), migration safety |
| G | SC5 |
| All | SC1 (handover count), SC8 (adoption gate) — measured cross-cutting over 14 days |

---

## Adoption gate (SC8)

Repeat scenarios A–G on three pilot repos at trust tiers `docs`, `tests`,
`implementation` for 14 days each. After all three pass without regression,
declare general availability.

---

## Known v1 limitations

### CODEOWNERS team handles not resolved

The two-key ceremony checks `CODEOWNERS` for direct `@user` handles only.
If a repo's CODEOWNERS file uses only team handles (`@org/team`), the
`verifyApproval()` call returns `team_membership_unresolved` (HTTP 403,
code `team_membership_unresolved`) rather than silently skipping the
check.

**Workaround:** Add an explicit `@user` entry to CODEOWNERS for any
platform engineer who needs to perform the ceremony, alongside the
existing team entry. Team-membership lookup via the GitHub team API is
deferred to a follow-up.

### Auto-merge is asynchronous relative to CI

The loretask-watcher fires `tryAutoMergeForCompletedTask` immediately
after PR creation (CI will usually still be pending at that point). The
merge engine returns `deferred:ci_failed` and records an audit entry.
A second fire occurs when CI completes via the
`check_run`/`check_suite` webhook → agent `/api/trigger/auto-merge`
path. If that webhook is not configured, the PR will stay open until the
next scheduled retry. Verify the GitHub App's webhook subscriptions
include `check_run` and `check_suite` events.

### notify default is empty in dark mode

The resolved `notify` field defaults to `[]` when `dark_factory.enabled
= true`. This is intentional: the `decideNotify()` helper always fires
escalation notifications regardless of the notify list (escalations are
never silenced), so listing `escalation` explicitly is redundant. If
you want completion notifications for watched tasks, set
`notify: ["escalation", "watched"]` explicitly.
