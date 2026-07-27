# Runbook: Dark Factory rollback

When to use this runbook: a repo running with `dark_factory.enabled =
true` is producing bad outcomes (auto-merging unintended PRs, hiding
escalations, breaking review flow) and needs to revert to legacy
behavior fast. Or: a cluster-wide incident requires disabling
auto-merge across all repos.

Severity: P2 (per-repo) or P1 (cluster-wide).

## The substrate you are rolling back on

Since the ADR-031 cutover there is no LoreTask CRD, no
`lore-claude-runner` image, and no `LORE_DARK_FACTORY_CLUSTER_ENABLED`
cluster gate. What exists instead:

- Every task and every assembly-line node runs as an **`Agent` custom
  resource** (`agents.re-cinq.com/v1alpha1`) in the **`ai-agents`**
  namespace, executed by the ai-agent-subsystem controller.
- The walk is **event-driven on the Floor**: state lives in
  `pipeline.assembly_lines` + `pipeline.assembly_line_nodes`; terminal
  CR phases emit `kubernetes.agent_node.*` events that
  `apps/floor/src/jobs/assembly-line/advance.ts` consumes; a
  per-minute reaper (`cron.assembly_line_reaper.tick`) resolves
  dropped events, relaunches missing CRs, and times out stuck nodes.
- **Merge authority is Floor-side only** — auto-merge never runs in a
  pod. Stopping the Floor stops all merges immediately.
- The only dark-factory switch is the per-repo
  `lore.repos.settings.dark_factory.enabled` field, behind the
  two-key gate.

## Pre-flight checks

Before disabling, snapshot the current state for forensics:

```bash
# Open assembly lines and their in-flight nodes
psql "$LORE_DB_URL" -c "
  SELECT al.id, al.definition_name, al.repo, al.branch, al.status,
         n.node_id, n.iteration, n.agent_cr_name, n.started_at
    FROM pipeline.assembly_lines al
    LEFT JOIN pipeline.assembly_line_nodes n
      ON n.assembly_line_id = al.id AND n.finished_at IS NULL
   WHERE al.status IN ('queued', 'running')
   ORDER BY al.created_at;
"

# Live Agent CRs (one per running node or single-CR task)
kubectl get agents.agents.re-cinq.com -n ai-agents \
  -L lore.re-cinq.com/task-id,lore.re-cinq.com/assembly-line-id,lore.re-cinq.com/node-id

# Active branch leases (if any tasks are in flight)
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
  SELECT created_at, repo, actor, payload->'changed'
    FROM pipeline.audit_log
   WHERE event_type = 'dark_factory_setting_changed'
   ORDER BY created_at DESC LIMIT 50;
"

# Event-loop health: anything dead-lettered during the incident window?
psql "$LORE_DB_URL" -c "
  SELECT event_name, status, count(*)
    FROM pipeline.events
   WHERE status IN ('failed', 'dead')
   GROUP BY 1, 2 ORDER BY 3 DESC;
"
```

Capture the output to a file. The reviewer comparing pre/post should
have the audit trail.

## Per-repo rollback (P2)

### Step 1: Disable dark mode

Any change to `enabled` is a privileged field — it requires the
two-key ceremony (admin-scoped token + an open PR labeled
`dark-factory-approval`, label applied by a CODEOWNER of the repo's
`CLAUDE.md`). Skip the ceremony only via the cluster-wide SQL path
below, with explicit incident authorization.

```bash
# Open the approval PR
gh pr create --repo "$REPO" \
   --title "rollback: disable dark_factory for $REPO" \
   --body "Per runbook dark-factory-rollback.md — disabling dark mode."

# CODEOWNER applies the label
gh pr edit "$PR_NUMBER" --repo "$REPO" --add-label dark-factory-approval

# Disable (route: apps/lore-api/src/api/routes/dark-factory/dark-factory.ts)
curl -X PUT "$LORE_API_URL/api/repos/$REPO/settings/dark-factory" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "X-Lore-Approval-PR: $REPO#$PR_NUMBER" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

The route merges the patch over the existing `dark_factory` block in a
transaction and writes the `dark_factory_setting_changed` audit entry
itself (including the ceremony evidence) — no manual audit insert
needed on this path.

Effect: tasks created after the flip see legacy posture (Issue per
task, no auto-merge, every PR awaits human review). In-flight tasks
complete on their original flow per FR4.4 — but auto-merge is
evaluated Floor-side at decision time, so any PR that has not merged
yet will now record `deferred:dark_mode_off` and wait for a human.

### Step 2: Reconcile in-flight work

```bash
# Open assembly lines for this repo, with their open node and CR name
psql "$LORE_DB_URL" -c "
  SELECT al.id, al.definition_name, al.branch, al.status,
         n.node_id, n.agent_cr_name, n.started_at
    FROM pipeline.assembly_lines al
    LEFT JOIN pipeline.assembly_line_nodes n
      ON n.assembly_line_id = al.id AND n.finished_at IS NULL
   WHERE al.repo = '$REPO' AND al.status IN ('queued', 'running');
"
```

Options per in-flight line:

| State | Action |
|---|---|
| Line running, node healthy | Let it complete on its original flow (FR4.4). Auto-merge will defer after the disable; the PR waits for a human |
| Node stuck | Do nothing — the per-minute reaper times it out at the node's `timeout_minutes` (+2 min buffer, default 60 min) and fails the line with `<kind>-timeout` |
| Line must be halted NOW | Follow the halt procedure below — order matters |
| PR open, awaiting auto-merge | It will not merge (`deferred:dark_mode_off`). Close it manually or let a human review and merge |
| Stale branch lease | The lease reaper (`cron.lease_reaper.tick`, every minute) deletes leases >5 min past expiry and writes a `lease_expired` audit entry. Force-release only a named row: `DELETE FROM pipeline.task_leases WHERE branch_name = $1;` |

**Halting a running line.** Mark the DB row terminal FIRST, then
delete the CR. The reaper relaunches missing CRs for open nodes every
minute — delete the CR first and it comes back:

```bash
# 1. Take the line out of the reaper's sweep (it only touches queued/running rows)
psql "$LORE_DB_URL" -c "
  UPDATE pipeline.assembly_lines
     SET status = 'failed', outcome = 'error',
         reason = 'manual halt: <ticket>', finished_at = now()
   WHERE id = '$ASSEMBLY_LINE_ID' AND status IN ('queued', 'running');
"

# 2. Kill the in-flight pod
kubectl delete agents.agents.re-cinq.com "$AGENT_CR_NAME" -n ai-agents

# 3. Cancel the backing task so nothing re-dispatches it
curl -X POST "$LORE_API_URL/api/task" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"cancel\", \"task_id\": \"$TASK_ID\"}"
```

### Step 3: Verify

```bash
# Trigger a small test task — confirm an Issue is created and the
# PR awaits human review.
curl -X POST "$LORE_API_URL/api/task" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\": \"gap-fill\", \"target_repo\": \"$REPO\", \"description\": \"Smoke test post-rollback\"}"

# Within 5 min: Issue should exist
gh issue list --repo "$REPO" --label lore-managed --limit 5

# And no auto_merge_decision with outcome 'merged' after the flip
psql "$LORE_DB_URL" -c "
  SELECT created_at, payload->>'outcome' FROM pipeline.audit_log
   WHERE event_type = 'auto_merge_decision' AND repo = '$REPO'
   ORDER BY created_at DESC LIMIT 10;
"
```

If the Issue exists and the PR is open without auto-merging,
rollback is complete.

## Cluster-wide rollback (P1)

When dark mode must be disabled across every onboarded repo
(suspected cluster-wide bug, uncontrolled auto-merge incident):

### Step 0 (optional, worst case): stop the Floor

Merge authority lives only in the Floor process. Scaling it to zero
halts every auto-merge, every line advance, and every reaper tick
immediately; in-flight Agent pods finish but nothing consumes their
results until scale-up. State is durable (`pipeline.events`,
`pipeline.assembly_lines`) — the reaper reconciles everything on
restart, so this is safe to do first and think second:

```bash
kubectl scale deployment/lore-floor -n lore-floor --replicas=0
```

Scale back to 1 after the settings are fixed (the chart pins
`replicaCount: 1` — do not scale higher, per ADR-037).

### Step 1: bulk-disable all dark-mode repos

```bash
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
incident authorization. Write an incident audit entry afterward
(the SQL path does not write one for you, unlike the API route):

```bash
psql "$LORE_DB_URL" -c "
  INSERT INTO pipeline.audit_log (event_type, actor, payload)
  VALUES (
    'dark_factory_setting_changed',
    '<your name>',
    jsonb_build_object(
      'changed', '[\"enabled (bulk rollback)\"]'::jsonb,
      'reason', 'incident: <ticket>',
      'two_key_bypassed', true
    )
  );
"
```

Notify Slack `#lore-escalation`:

```
Dark Factory cluster-wide rollback executed.
Reason: <ticket>
Authorized by: <name>
Affected repos: <count>
```

### Step 2: drain in-flight work

With `enabled = false` everywhere, in-flight lines finish but nothing
auto-merges (`deferred:dark_mode_off`). If lines must be killed, use
the per-line halt procedure above (DB row first, then CR). To sweep
all live pods after failing their rows:

```bash
kubectl get agents.agents.re-cinq.com -n ai-agents
# then, per CR you have already failed in the DB:
kubectl delete agents.agents.re-cinq.com <name> -n ai-agents
```

## Recovery (re-enabling dark mode)

After the incident is resolved and post-mortem complete:

1. Confirm the event loop is clean: no `pipeline.events` rows stuck in
   `processing`, and triage anything in `dead`.
2. Re-run the two-key ceremony per repo via the PUT route (do not
   bulk re-enable via SQL — the route's audit trail is the record).
3. Start with the lowest-trust repo (`docs`).
4. Watch the dashboard and `auto_merge_decision` audit entries for
   24 hours.
5. Promote the next trust tier only after green.

## Pilot rollout (enabling a new repo)

### Step 1 — pick a pilot repo

Choose a repo that:

- Has CLAUDE.md, AGENTS.md, and a CODEOWNERS file (so escalation
  routing and the two-key ceremony work).
- Has been onboarded to Lore for at least 7 days (so memory + facts
  have warmed).
- Has at least one human reviewer who can intercept misbehavior fast.
- **Not** a production-critical repo (auth / payments / billing).

Enable via the API route, not raw SQL — the route merges the patch
over any existing `dark_factory` fields inside a transaction (no
clobber risk) and records the ceremony. Check what is there first:

```bash
curl -s "$LORE_API_URL/api/repos/$REPO/settings/dark-factory" \
  -H "Authorization: Bearer $LORE_TOKEN"

curl -X PUT "$LORE_API_URL/api/repos/$REPO/settings/dark-factory" \
  -H "Authorization: Bearer $LORE_TOKEN" \
  -H "X-Lore-Approval-PR: $REPO#$PR_NUMBER" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "auto_merge": {"min_trust": "docs"}}'
```

Or via the settings UI: navigate to the repo, toggle "Dark factory
mode" → on (the UI walks the same two-key ceremony).

### Step 2 — soak for 7 days

Watch:

- **Auto-merge decisions** in `pipeline.audit_log`. The `rule` payload
  shows which gate fired (path, trust, ci, bot-approval). Sample query:

  ```sql
  SELECT created_at, repo, payload->>'pr_number' AS pr,
         payload->>'outcome'    AS outcome,
         payload->'rule'        AS rule
    FROM pipeline.audit_log
   WHERE event_type = 'auto_merge_decision'
     AND repo = 'org/pilot-repo'
   ORDER BY created_at DESC LIMIT 50;
  ```

- **Escalation Issues** labelled `needs-human-help` — should be rare
  (< 1 per 50 tasks).
- **Failed lines and CRs** —

  ```bash
  psql "$LORE_DB_URL" -c "
    SELECT id, definition_name, outcome, reason FROM pipeline.assembly_lines
     WHERE repo = 'org/pilot-repo' AND status = 'failed'
     ORDER BY created_at DESC LIMIT 20;
  "
  kubectl get agents.agents.re-cinq.com -n ai-agents \
    --field-selector status.phase=Failed
  ```

### Step 3 — ramp

Promote the pilot repo's `auto_merge.min_trust` one tier at a time
(`docs` → `tests` → `implementation` → `full`), waiting at least
3 successful merges at each tier (the auto-promotion logic lives in
`apps/floor/src/jobs/merge/merge-check.ts`; threshold via
`lore.repos.settings.trust.auto_promote_threshold`, default 3).

Note: `auto_merge.paths` changes and downgrading `require_green_ci` /
`require_bot_approval` to false are two-key fields — each needs its
own approval PR. Raising `min_trust` is admin-scope only.

## Related

- ADR-016 — Dark Factory mode decision
- ADR-031 — the ai-agent-subsystem cutover (why LoreTask commands are gone)
- spec at `specs/6-dark-factory/spec.md` (FR6.7–FR6.10: the event-driven walk)
- quickstart scenarios at `specs/6-dark-factory/quickstart.md`
- contract at `specs/6-dark-factory/contracts/dark-factory-settings.md`
- station contract at `specs/6-dark-factory/contracts/station-contract.md`
