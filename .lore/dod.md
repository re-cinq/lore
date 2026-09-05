# Definition of Done

Strategy: direct
Why: The seam is the GitHub Actions workflow YAML files — `on.push.paths` presence is directly
readable without infrastructure. `build-ui.yml` already documents the root cause and the fix,
making the failing condition unambiguous.

Acceptance tests:
  - scripts/ci/deploy-workflows.test.mjs::"service deploy workflows trigger without a paths: guard on push to main" —
    every workflow that calls deploy-lore-platform.sh must have no `on.push.paths` filter;
    GitHub's push-event filter can silently suppress a workflow when N services change in one
    PR, leaving those services on old images with no CI turning red.

Facets (the red-green-refactor steps you expect, smallest first):
  - Remove `on.push.paths:` from build-floor.yml; add a `changes` job using in-runner git diff (see build-ui.yml for the canonical pattern).
  - Same for build-mcp-server.yml.
  - Same for build-lore-api.yml.
  - Same for build-event-router.yml.
  - Same for build-stations.yml.
  - Same for build-cluster-agent.yml.
  - Each workflow's `build` (and `deploy`) job adds `needs: changes` and `if: needs.changes.outputs.relevant == 'true'` so irrelevant pushes still skip the build.

Out of scope:
  - The lock-contention classifier (helm-lock-contention.sh) — already tested and green.
  - The ATTEMPTS retry budget — already bumped to 24 and covers the full fan-out.
  - The deploy-ai-agents.yml workflow — its trigger paths are narrow enough that it never
    participates in the concurrent-deploy scenario described by this ticket.
  - Ordering of deployments across services — the umbrella release and --reset-then-reuse-values
    guarantee eventual consistency once all workflows trigger.
