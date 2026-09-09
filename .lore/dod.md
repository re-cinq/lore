# Definition of Done

> Concurrent umbrella deploys fail: a PR touching N services silently leaves them on old images
>
> "Nothing serializes them: a commit touching `libs/shared` matches most of their
> path filters, so up to eight fire simultaneously on one push and then fight over
> one release lock."

**Strategy: `changes_requested`** — the ticket's central claim (concurrent umbrella
deploys fight the Helm release lock and then die on the `lore-ui-migrate` pre-upgrade
hook, leaving services stale) is a runtime, cluster-level race with no code seam a CI
acceptance test can exercise for that reason. Worse, its three proposed fixes conflict,
and the one the reporter offers to "stop the bleeding" is documented-broken in this very
repo. A human design decision is owed before DONE can be expressed as failing tests.

## Why this can't be a red bar for its stated reason

- **Option 1 (single shared GitHub `concurrency` group) is already rejected here.**
  `scripts/ci/deploy-lore-platform.sh`'s header states it outright: "A GitHub
  `concurrency` group can't (it keeps only one pending run and cancels the rest), so we
  serialize on Helm's own release lock." With N per-service deploys queued behind one
  group, GitHub keeps ONE pending and cancels the intermediates — each cancelled run is a
  different service's tag that never deploys: the ticket's own symptom. A test asserting a
  shared concurrency group would go green on a fix that re-creates the bug, so option 1 is
  not a valid DoD.
- **Option 2 (single umbrella deploy job) is the endorsed real fix but has no seam as
  specified.** `deploy-lore-platform.sh` upgrades ONE subchart per invocation; option 2
  needs a new "upgrade the release once with whatever tags are current" path, and "whatever
  tags are current" is unspecified — read from the running release? from parallel
  build-job outputs? from committed `values.yaml`? That choice IS the seam a
  `parallel-change` first test would go through; inventing it here pins a design the ticket
  left open. It is also a re-architecture of eight workflows plus the deploy script.
- **Option 3 (cheap/conditional migrate hook) is unmeasured.** The reporter's own words:
  the hook "is documented as idempotent and skip-if-applied, so the time is presumably
  spent on pod scheduling rather than SQL — worth measuring before assuming." No defined
  behaviour to test until the slowness is profiled.
- **The fatal error in the trace is the hook, not the lock.** `pre-upgrade hooks failed:
  resource Job/lore-ui/lore-ui-migrate not ready ... context deadline exceeded`. The retry
  ladder already handles lock contention (the reporter agrees "that part works"); the
  remaining failure is a cluster-side hook timeout, only observable against a real cluster.

## What I would need to write the DoD

- [ ] A decision between options 2 and 3 (option 1 is off the table per the deploy-script header).
- [ ] If option 2: where the single upgrade sources each service's current tag
  (running-release values / parallel build-job outputs / committed `values.yaml`). That fixes
  the seam a `parallel-change` first test can go through.
- [ ] If option 3: a profile of why `lore-ui-migrate` misses the Helm deadline, and the
  intended behaviour (skip when no migration files changed vs. speed up pod scheduling).

## Related, not this ticket

- A red bar for a DIFFERENT mechanism already lives on this branch:
  `scripts/ci/deploy-workflows.test.mjs` pins that deploy workflows carry no
  `on.push.paths` filter — the "GitHub silently SKIPS a workflow" cause, not the "fight the
  lock / hook timeout" cause this ticket's body describes. Making it green does not fix the
  reported contention. Note it also makes MORE workflows fire on a shared push (increasing
  contention), so it must land together with a real serialization fix, not alone.
- The reporter's "Also worth having" (reconcile the running image tag against the tag built
  from `main`) is a separate observability feature and needs a cluster to run.
