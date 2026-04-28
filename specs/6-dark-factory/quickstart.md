# Quickstart: Dark Factory Mode verification

Maps each spec scenario to a concrete verification procedure. Run after Phase 5 deploy on a pilot repo. Each scenario corresponds 1:1 to a `## User Scenarios & Acceptance Criteria` entry in `spec.md` and to one or more success criteria.

## Pre-flight

```bash
# 1. Pick a pilot repo (e.g. trust=docs).
export REPO=re-cinq/test-darkmode

# 2. Enable dark mode via the two-key ceremony.
gh pr create --title "dark-factory: enable for $REPO" \
   --body "Enable dark factory mode" --label dark-factory-approval
# Get a CODEOWNER to verify the label and apply approval.

# 3. PUT the settings (assumes you already have admin token in $LORE_TOKEN).
curl -X PUT "$LORE_API_URL/api/repos/$REPO/settings/dark-factory" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "X-Lore-Approval-PR: $REPO#42" \
  -d '{"enabled": true}'
```

## Scenario A: Routine doc PR auto-merges (Spec Scenario 1, SC3, SC6)

```bash
# 1. Trigger gap-detect manually for the pilot repo.
gh workflow run gap-detect.yml -f repo=$REPO

# 2. Wait for the supervisor to run the gap-fill workflow (≤ 5 min).
# 3. Inspect the resulting PR.
gh pr list -R $REPO --search "author:app/lore-agent" --limit 1 --json number,state,title,body

# 4. Verify the PR was auto-merged on green CI.
# Expected: state=MERGED, body contains "Lore-Task: <uuid>" and a link to the auto-merge audit entry.

# 5. Confirm no GitHub Issue was created.
gh issue list -R $REPO --label lore-managed --search "task <uuid>"
# Expected: empty.

# 6. Inspect commit trailers on the merged branch.
git fetch origin
git log origin/lore/gap-fill/... --pretty=format:"%H %s%n%b" | grep "Lore-Stage:"
# Expected: stages in order: draft → validate → push → retrospective.
```

**Pass:** PR merged ≤ 24h, no Issue exists, all stages present, audit log entry references the merge rule.

## Scenario B: Implementation task survives pod death (Spec Scenario 2, SC2)

```bash
# 1. Create an implementation task.
curl -X POST "$LORE_API_URL/api/tasks" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -d "{\"task_type\":\"implementation\",\"target_repo\":\"$REPO\",\"description\":\"Add a no-op test fixture\"}"

# 2. After [stage:implement] and [stage:validate] commits land, kill the pod.
kubectl delete pod -n lore-agent -l task-id=<uuid>

# 3. Wait 10 minutes for lease expiry.
# 4. A replacement pod takes over. Inspect git log.
git log origin/lore/feature/... --pretty=format:"%H %s"
# Expected: implement, validate, push, review, retrospective — without duplicates.

# 5. Verify lease history.
psql $LORE_DB -c "SELECT event_type, payload FROM pipeline.audit_log WHERE task_id='<uuid>' ORDER BY created_at"
# Expected: one lease_expired entry, one new acquire, no duplicate stage commits.
```

**Pass:** Final PR has the unbroken stage sequence, no phase was re-executed, audit log shows the takeover.

## Scenario C: Code change requires human review (Spec Scenario 3, SC6)

```bash
# 1. Create a general task that edits agent/src/* (outside auto-merge allowlist).
curl -X POST "$LORE_API_URL/api/tasks" \
  -d "{\"task_type\":\"general\",\"target_repo\":\"$REPO\",\"description\":\"Refactor X in agent/src/foo.ts\"}"

# 2. Wait for PR.
gh pr list -R $REPO --author app/lore-agent --limit 1 --json number,state

# 3. Confirm it is NOT auto-merged.
# Expected: state=OPEN, bot review comments present, mergeable but waiting human.

# 4. Inspect audit log for the deferral reason.
psql $LORE_DB -c "SELECT payload->'outcome', payload->'rule' FROM pipeline.audit_log WHERE event_type='auto_merge_decision' AND task_id='<uuid>'"
# Expected: outcome="deferred:path_outside_allowlist".
```

**Pass:** PR open, audit log explains why auto-merge declined, bot review comments visible.

## Scenario D: Approval gate produces an Issue (Spec Scenario 4)

```bash
# 1. Set the task type to require approval (per-task override or repo setting).
curl -X POST "$LORE_API_URL/api/tasks" \
  -d '{"task_type":"general", ..., "approval_required": true}'

# 2. Verify an Issue is created.
gh issue list -R $REPO --search "lore-managed task <uuid>"
# Expected: one Issue with full task description and approval instructions.

# 3. Confirm no commits exist yet on a candidate branch.
git ls-remote origin "lore/general/...<task_id>"
# Expected: empty.

# 4. Apply the approval label.
gh issue edit <num> -R $REPO --add-label approved

# 5. Wait for supervisor to start. Verify branch begins committing.
```

**Pass:** Issue exists, no work began until label applied, after label the workflow proceeds normally.

## Scenario E: Escalation produces an Issue with full context (Spec Scenario 5)

```bash
# 1. Force a validation failure: create an implementation task that intentionally produces broken TypeScript.
curl -X POST "$LORE_API_URL/api/tasks" -d '{...spec instructing a syntax error...}'

# 2. Wait through 2 iterations of validate → implement → validate (fail twice).
# 3. Verify escalation Issue is created.
gh issue list -R $REPO --label needs-human-help
# Expected: Issue with branch link, validation output, contributing facts/memories.

# 4. Confirm Slack escalation notification fired.
# Check the configured #lore-escalation channel.

# 5. Verify the branch carries partial work.
git log origin/lore/.../<task> --pretty=format:"%H %s"
# Expected: stage commits up to and including the failed validate(s).
```

**Pass:** Issue exists with diagnostic content, Slack message fired, branch carries partial work, task status `needs-human-help`.

## Scenario F: Repo opts out of dark mode (Spec Scenario 6)

```bash
# 1. Set dark_factory.enabled = false on a repo (or pick a non-pilot repo).
# 2. Trigger any task type.
# 3. Verify behavior is identical to today: Issue created, status comments posted, no auto-merge, every PR awaits review.
gh issue list -R $REPO --label lore-managed
# Expected: one Issue per task as before.

# 4. Verify trailers ARE still present (Q5 clarification).
git log origin/<branch> --pretty=format:"%b" | grep "Lore-Stage:"
# Expected: stages present even though dark mode is off.
```

**Pass:** Behavior matches pre-feature for opt-out repos; trailers still emitted.

## Scenario G: PR-to-task cross-reference works without Issues (Spec Scenario 7, SC5)

```bash
# 1. Open a merged PR from Scenario A in the web-ui.
open "$LORE_UI_URL/pipeline/by-pr/$REPO/<pr_number>"
# Expected: web-ui resolves the Lore-Task: trailer and renders the timeline.

# 2. Verify reverse direction.
open "$LORE_UI_URL/pipeline/<task_uuid>"
# Expected: shows branch, stage timeline, retrospective episode, link to PR.
```

**Pass:** Both directions resolve in one click; timeline shows all stages with durations and outcomes.

## Success criteria mapping

| Scenario | Success criteria covered |
|---|---|
| A | SC3, SC4, SC6, SC7 |
| B | SC2, SC5 |
| C | SC6, SC7 |
| D | SC4 (preserves approval-gated Issue creation) |
| E | SC4, SC5 |
| F | SC5 (audit completeness on opt-out), migration safety |
| G | SC5 |
| All | SC1 (handover count), SC8 (adoption gate) — measured cross-cutting over 14 days |

## Adoption gate (SC8)

Repeat scenarios A–G on three pilot repos at trust tiers `docs`, `tests`, `implementation` for 14 days each. After all three pass without regression, declare general availability.
