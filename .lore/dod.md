# Definition of Done

> Handle `cron.daily_digest.tick`. Start floor runs. Forward args. Ensure no overlaps by querying open runs. Read `slack_users` directly from DB.

**Strategy: `direct`** — The test calls `digestTick` and passes a double for `deps` exactly as the existing tests do, intercepting the start values sent to the floor. The red bar is CI's to show; the test is run via the `stations` matrix job.

## Done when these pass

- [ ] **FR14.20 — The slack_users override of FR12 is read through the settings port's orgSetting, so the stations service reads it without SQL of its own.** — verifies that `slack_users` is read and forwarded as a start item to the external floor.
  `apps/stations/src/work/digest-tick/digest-tick.acceptance.test.ts`

## Facets

- [ ] Read `slack_users` from `orgSetting("slack_users")`
- [ ] Pass it as `slack_users` in the `startItems` sent to the floor

## Out of scope

- The tick's other criteria (starts runs, prevents overlaps) are already tested and implemented on the branch's base.