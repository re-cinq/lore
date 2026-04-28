# Runbook: Dark Factory rollback

When to use this runbook: a repo running with `dark_factory.enabled =
true` is producing bad outcomes (auto-merging unintended PRs, hiding
escalations, breaking review flow) and needs to revert to legacy
behavior fast. Or: a cluster-wide incident requires disabling
auto-merge across all repos.

Severity: P2 (per-repo) or P1 (cluster-wide).

## Pre-flight checks

Before disabling, snapshot the current state for forensics:

```bash
# Active leases (if any tasks are in flight)
psql "$LORE_DB_URL" -c "SELECT * FROM pipeline.task_leases;"

# Last 50 auto-merge decisions
psql "$LORE_DB_URL" -c "
  SELECT created_at, repo, payload->>'pr_number' AS pr,
         payload->>'outcome' AS outcome
    FROM pipeline.audit_log
   WHERE event_type = 'auto_merge_decision'
   ORDER BY created_at DESC LIMIT 50;
"

# Last 50 settings changes
psql "$LORE_DB_URL" -c "
  SELECT created_at, repo, actor, payload->>'field_paths_changed'
    FROM pipeline.audit_log
   WHERE event_type = 'dark_factory_setting_changed'
   ORDER BY created_at DESC LIMIT 50;
"
```

Capture the output to a file. The reviewer comparing pre/post should
have the audit trail.

## Per-repo rollback (P2)

### Step 1: Disable dark mode

The toggle is a privileged field — requires the two-key ceremony.
Skip the ceremony only if you have a clear cluster-incident
authorization to bypass.

```bash
# Open the approval PR
gh pr create --repo "$REPO" \
   --title "rollback: disable dark_factory for $REPO" \
   --body "Per runbook dark-factory-rollback.md — disabling dark mode."

# CODEOWNER applies the label
gh pr edit "$PR_NUMBER" --repo "$REPO" --add-label dark-factory-approval

# Disable
curl -X PUT "$LORE_API_URL/api/repos/$REPO/settings/dark-factory" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "X-Lore-Approval-PR: $REPO#$PR_NUMBER" \
  -d '{"enabled": false}'
```

Effect: all subsequent task creations on this repo see legacy
posture (Issue per task, no auto-merge, every PR awaits human
review). In-flight tasks complete on their original flow per FR4.4.

### Step 2: Reconcile in-flight tasks

```bash
# List active leases for this repo
psql "$LORE_DB_URL" -c "
  SELECT tl.branch_name, tl.holder, tl.expires_at, t.id AS task_id, t.status
    FROM pipeline.task_leases tl
    JOIN pipeline.tasks t ON t.id = tl.task_id
   WHERE t.target_repo = '$REPO';
"
```

Three options for in-flight tasks:

| State | Action |
|---|---|
| Lease held, work in progress | Let it complete on legacy flow (FR4.4 — already enforced) |
| Lease held but stuck (>10 min idle) | Wait for TTL expiry; reaper deletes the row 5 min after expiry. Or force-release via `DELETE FROM pipeline.task_leases WHERE branch_name = $1 AND holder = $2;` (named holder only) |
| PR open, awaiting auto-merge | The PR will not auto-merge after disable. Either close it manually or let a human review and merge |

### Step 3: Verify

```bash
# Trigger a small test task — confirm an Issue is created and the
# PR awaits human review.
curl -X POST "$LORE_API_URL/api/task" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -d "{\"task_type\":\"gap-fill\",\"target_repo\":\"$REPO\",\"description\":\"Smoke test post-rollback\"}"

# Within 5 min: Issue should exist
gh issue list --repo "$REPO" --label lore-managed --limit 5
```

If the Issue exists and the PR is open without auto-merging,
rollback is complete.

## Cluster-wide rollback (P1)

When dark mode must be disabled across every onboarded repo
(suspected cluster-wide bug, uncontrolled auto-merge incident):

```bash
# Bulk-disable all dark-mode repos.
psql "$LORE_DB_URL" -c "
  UPDATE lore.repos
     SET settings = jsonb_set(
           coalesce(settings, '{}'::jsonb),
           '{dark_factory,enabled}',
           'false'::jsonb
         )
   WHERE settings->'dark_factory'->>'enabled' = 'true';
"
```

This bypasses the two-key ceremony — only do this with explicit
incident authorization. Write an incident audit entry afterward:

```bash
psql "$LORE_DB_URL" -c "
  INSERT INTO pipeline.audit_log (event_type, payload)
  VALUES (
    'dark_factory_setting_changed',
    jsonb_build_object(
      'field_paths_changed', '[bulk_rollback]'::jsonb,
      'reason', 'incident: <ticket>',
      'authorized_by', '<your name>',
      'two_key_bypassed', true
    )
  );
"
```

Notify Slack `#lore-escalation`:

```
🚨 Dark Factory cluster-wide rollback executed.
Reason: <ticket>
Authorized by: <name>
Affected repos: <count>
```

## Recovery (re-enabling dark mode)

After the incident is resolved and post-mortem complete:

1. Re-run the two-key ceremony per repo (do not bulk re-enable).
2. Start with the lowest-trust repo (`docs`).
3. Watch the dashboard for 24 hours.
4. Promote the next trust tier only after green.

## Cluster path enablement

The cluster-side dark-factory path (impl / general / review tasks
running through `/app/dist/supervisor/runner-cli.js` inside Job pods)
is gated by **two** independent switches:

1. **Per-repo:** `lore.repos.settings.dark_factory.enabled = true`
   (set via the settings UI / API). Without this, the repo gets the
   legacy flow regardless.
2. **Cluster-wide:** `LORE_DARK_FACTORY_CLUSTER_ENABLED=true` on the
   agent deployment env (helm `values.yaml`). Without this, the worker
   refuses to forward `darkFactoryWorkflow` to the LoreTask CR — the
   pod runs the legacy `claude --print` path even for dark-mode repos.

The cluster-wide gate exists because the cluster path needs the agent
build present at `/app/dist/` in the claude-runner image. If the helm
flag flipped before the image had `dist/`, every Job pod would fail at
the first line of the dark-factory branch in `entrypoint.sh`.

### Rollout procedure

#### Step 0 — verify the image is ready

```bash
# Pull the most recent claude-runner tag
IMAGE=ghcr.io/re-cinq/lore-claude-runner:latest
docker pull "$IMAGE"

# Both must succeed:
docker run --rm --entrypoint sh "$IMAGE" -c \
  'test -f /app/dist/supervisor/runner-cli.js && ls /app/dist/workflows/*.yaml'
```

If either check fails, the image build pipeline (PR #311 onward) didn't
ship the agent dist or workflow YAMLs. Stop — fix the image before
flipping the flag.

#### Step 1 — flip the cluster flag (no per-repo change yet)

```bash
helm upgrade --reuse-values lore-agent ./terraform/modules/gke-mcp/agent-helm \
  --namespace lore-agent \
  --set env.LORE_DARK_FACTORY_CLUSTER_ENABLED=true
kubectl rollout status deployment/lore-agent -n lore-agent --timeout=2m
```

This is a no-op for any repo with `dark_factory.enabled = false` —
those still get the legacy path. Only repos that already opted in
will start routing impl/general/review through the cluster supervisor.

If no repo has dark mode on yet, this flip is a pure pre-flight and
you proceed to step 2. If a repo already has `dark_factory.enabled =
true` (e.g. the docs-only path was piloted via the in-agent supervisor
in PR #308), expect those to start using the cluster path on their
next impl/general/review task — confirm by watching `kubectl logs`
for `[runner-cli] Starting dark-factory supervisor`.

#### Step 2 — pick a pilot repo

Choose a repo that:

- Has CLAUDE.md, AGENTS.md, and a CODEOWNERS file (so escalation
  routing works).
- Has been onboarded to Lore for at least 7 days (so memory + facts
  have warmed).
- Has at least one human reviewer who can intercept misbehavior fast.
- **Not** a production-critical repo (auth / payments / billing).

Enable dark mode on it:

```sql
UPDATE lore.repos
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{dark_factory}',
  '{"enabled": true, "auto_merge": {"min_trust": "docs"}}'::jsonb
)
WHERE full_name = 'org/pilot-repo';
```

Or via the settings UI: navigate to the repo, toggle "Dark factory
mode" → on.

#### Step 3 — soak for 7 days

Watch:

- `pipeline.audit_log` — `auto_merge_decision` rows. The `rule` field
  shows which gate fired (path, trust, ci, bot-approval).
- Escalation Issues labelled `needs-human-help` — should be rare
  (< 1 per 50 tasks).
- Cluster-pod failures — `kubectl get loretasks -n lore-agent -l
  lore.re-cinq.com/dark-factory=true` then `kubectl describe` any in
  `Failed` state.

#### Step 4 — ramp

Promote the pilot repo's `auto_merge.min_trust` one tier at a time
(`docs` → `tests` → `implementation` → `full`), waiting at least
3 successful merges at each tier (the auto-promotion logic lives in
`agent/src/jobs/dark-factory-baseline.ts`).

Once two repos have soaked at `implementation` for 7 days each, flip
the helm default:

```yaml
# values.yaml
env:
  LORE_DARK_FACTORY_CLUSTER_ENABLED: "true"  # was "false"
```

Bake-in is the operational signal that the cluster path is the new
default for opted-in repos.

### Rollback at any step

To unflip the cluster gate:

```bash
helm upgrade --reuse-values lore-agent ./terraform/modules/gke-mcp/agent-helm \
  --namespace lore-agent \
  --set env.LORE_DARK_FACTORY_CLUSTER_ENABLED=false
```

In-flight Job pods finish (they're already running the cluster
supervisor). New tasks route through the legacy path immediately.

To unflip a single repo's dark mode, see "Per-repo rollback" above.

## Known gaps

### Cluster-path PRs do not auto-merge yet

The in-agent supervisor retrospective handler wires
`evaluateAndMerge`, so dark-mode `gap-fill` / `runbook` PRs auto-merge
on green CI + bot-approved + path-allowlisted changes (PR #308).
Cluster-path workflows (`implementation` / `general` / `review`,
PR #310) intentionally skip auto-merge inside the Job pod because the
`loretask-watcher` owns PR creation — firing `evaluateAndMerge` from
inside the pod would race the watcher.

Until the watcher grows a "PR created from dark-factory pod → trigger
`evaluateAndMerge`" hook, those PRs land but wait for human merge.

**Operational impact:** in dark mode, expect mixed behavior — docs-only
tasks auto-merge end-to-end, code tasks land a PR that still needs a
human merge click. Tracked separately from this runbook's rollback
flow; this is not a regression to roll back, just a not-yet-shipped
feature.

## Related

- ADR-016 — Dark Factory mode decision
- spec at `specs/6-dark-factory/spec.md`
- quickstart scenarios at `specs/6-dark-factory/quickstart.md`
- contract at `specs/6-dark-factory/contracts/dark-factory-settings.md`
