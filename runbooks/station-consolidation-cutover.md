# Runbook: Station consolidation cutover

When to use this runbook: merging the `fix/internal-token-mismatch`
branch, which moves every non-agent station into one registry, turns
`pipeline.events` into a per-subscriber delivery bus, and makes the
merge a nine-node assembly line.

Severity: P1 if performed out of order. Nothing in CI or Helm enforces
the sequence below, and two of the steps fail **silently** — the
factory keeps serving, and work simply stops arriving.

## Why the order is load-bearing

Two facts, neither visible from a green build:

1. **`EVENT_ROUTER_URL` and `LORE_API_URL` reach the stations chart only
   through `terraform apply`** ([lore-platform.tf:246-260](../infra/terraform/lore-platform.tf#L246-L260)).
   `helm_release.lore_platform` sets `reuse_values = true`, so a CI
   redeploy re-uses the STORED values and never learns a key terraform
   has not applied yet. Until that apply runs, the stations pods serve
   HTTP and **drain nothing**: `selectEventReporter` falls back to the
   local pool, which is correct on a laptop and wrong here.
   Every service-form node then sits open until the reaper's budget —
   for the merge line, ~62 minutes per step, each recorded `failed`.
   This is a functional prerequisite, the same class of trap as the
   Helm stored-values shadow.

2. **The Floor must not publish `station.run` before stations subscribes.**
   Deliveries are only created for names that already hold a row in
   `pipeline.event_subscriptions`, and subscription rows are written by
   each process at boot. A Floor that publishes into a bus nothing has
   subscribed to produces an **orphaned event**: no delivery, no
   dead-letter, no error line. `deploy-lore-platform.sh` pins one short
   SHA per subchart, so a merge-push race can land exactly this.

## The order

Run each step to completion and verify before starting the next.

1. **`terraform apply`** — the chart env additions.
   Verify the keys actually landed, because stored values shadow
   subchart edits:
   ```
   helm get values lore-platform -n lore-api | grep -A6 'lore-stations'
   ```
   `EVENT_ROUTER_URL` and `LORE_API_URL` must both be present. If they
   are not, STOP — every later step will look healthy and drain nothing.

2. **Migrations** (`0048_event_deliveries.sql`). Idempotent, tracked in
   `lore.schema_migrations`.

3. **event-router** — fan-out becomes active. No consumer behaviour has
   changed yet: the Floor is still the only subscriber, so this step is
   independently safe and independently revertible.

4. **stations** — subscribes at boot, then drains. Verify it registered
   before moving on:
   ```sql
   SELECT event_name FROM pipeline.event_subscriptions
    WHERE subscriber = 'stations' ORDER BY 1;
   ```
   `station.run` must appear. This is the step the Floor depends on.

5. **floor** — starts publishing `station.run` and drops the
   subscriptions that moved. Safe only after step 4.

6. **lore-api** — last, since it loses the maintenance route.

## The deploy window

During steps 4-5 both drainers are briefly live, and nothing gives the
stations service a sole-instance gate. The delivery row is the unit of
work and `claim` is one `FOR UPDATE SKIP LOCKED` statement, so two
claimers still receive disjoint batches — but an event claimed by the
OLD queue-drain path and an event claimed by the NEW delivery path are
different rows describing the same happening, and both can run.

Keep the window short, and land this when nothing else is queued.
Steps 4 and 5 back to back, not hours apart.

## Verifying the cutover

```sql
-- Orphans: events nobody was subscribed to. Must be empty.
SELECT event_name, count(*) FROM pipeline.events e
 WHERE NOT EXISTS (SELECT 1 FROM pipeline.event_deliveries d WHERE d.event_id = e.id)
   AND e.captured_at > now() - interval '1 hour'
 GROUP BY 1;

-- Dead letters in the last hour. Must be zero.
SELECT count(*) FROM pipeline.event_deliveries
 WHERE status = 'dead' AND handled_at > now() - interval '1 hour';

-- Service nodes actually finishing rather than reaping.
SELECT node_id, outcome, count(*) FROM pipeline.station_runs
 WHERE started_at > now() - interval '1 hour' GROUP BY 1, 2 ORDER BY 3 DESC;
```

A merge line whose `settle` node fails stops after three attempts
(`MAX_MERGE_LINE_ATTEMPTS`) rather than restarting every minute. Three
failed `merge` runs for one task means the line is genuinely broken —
read the `settle` visit's failure detail rather than re-running it.

## Rolling back

Steps 1-3 need no rollback: fan-out with one subscriber behaves as the
old queue did.

From step 5, roll the **floor** back first, not stations. A Floor on the
old image stops publishing `station.run` and resumes launching pods; a
stations service left running simply finds nothing to claim. The reverse
order strands every in-flight service node.

Delivery rows already claimed are not lost — they return to `pending`
at their visibility timeout and are re-claimed by whichever drainer is
live.
