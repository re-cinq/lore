# Feature Specification: Automated Claude Headless Container Rebuilds

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | Automated Container Image Rebuild Pipeline |
| Branch            | container-rebuild-automation                |
| Status            | Draft                                      |
| Created           | 2026-03-25                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 2-3 working days                           |
| Full Stack Target | 2-3 weeks                                  |

## Problem Statement

Lore runs Claude Code in headless mode inside containers (on GKE) to
execute complex agent tasks — implementation, multi-agent parallel work,
and large refactorings. Currently, the container image is built once and
remains static. When Claude SDK releases a new version, when `@anthropic-ai/sdk`
dependencies need security patches, or when other upstream dependencies
have breaking changes, the image becomes stale and potentially broken.

There is no automated mechanism to detect these changes, trigger rebuilds,
test the new images, and deploy them. This creates a window of vulnerability:
agents may be running outdated, insecure, or incompatible code. Manual
intervention is required, which is slow and error-prone.

The result: agents degrade silently, security patches lag, and the team
must manually check for updates and coordinate rebuilds across the cluster.

## Vision

Lore automatically detects upstream dependency updates (Claude SDK, Node.js,
system packages), rebuilds the headless Claude Code container image,
tests the new image against a suite of reference tasks, validates it on GKE,
and rolls out the new image to production with zero downtime. All with
minimal human involvement.

When a new Claude model version is released or a critical security patch
lands, the new image is in production within hours, not weeks.

## User Personas

### Platform Engineer (Operator)

Maintains the Lore infrastructure on GKE. They need to know immediately
when a build fails, when a validation test breaks, and when a rollout
completes. They need confidence that the new image works before it runs
live agent tasks.

### Security Engineer

Monitors CVE databases and container registries for vulnerabilities.
They need automated patching of system packages, deterministic rebuild
triggers, and audit logs showing what changed in each build.

### Agent (Upstream Consumer)

The Lore Agent service (`agent/`) depends on the headless Claude Code
container image. It needs the image to always be fresh, compatible,
and available on the registry so new task workers can pull it
without delay.

### Release Coordinator (Claude SDK team, external)

When Anthropic releases a new Claude SDK version or deprecates an old
one, they need Lore's container image to automatically adapt without
manual PRs or coordination.

## User Scenarios & Acceptance Criteria

### Scenario 1: Claude SDK Minor Update Released

**Trigger:** Anthropic releases `@anthropic-ai/sdk@0.25.0` on npm.

**Flow:**
1. Renovate detects the new version in `agent/package.json` (or mcp-server)
2. Renovate opens a PR with updated lockfile
3. Merge trigger fires (in GitHub Actions)
4. Container build pipeline checks if it's a rebuild-worthy change
5. Dockerfile is rebuilt with new lockfile
6. New image is pushed to GCR with tag `ghcr.io/re-cinq/claude-headless:claude-sdk-0.25.0`
7. Validation suite runs on GKE (5 reference agent tasks)
8. All tests pass
9. Image is tagged as `:latest` and manifest updated on GKE
10. Rollout completes (existing agents finish current tasks, new workers use new image)
11. Slack notification sent to #platform-eng with tag and test results

**Acceptance Criteria:**
- Build pipeline detects the PR within 5 minutes of merge
- Container is rebuilt and pushed within 15 minutes
- Validation suite completes in under 10 minutes
- New image is available in GCR and GKE registry
- No running agent tasks are interrupted (graceful rollout)
- Platform engineer receives a summary Slack message with pass/fail and logs link

### Scenario 2: System Package CVE Detected

**Trigger:** Security scanner detects CVE in base OS package (e.g., OpenSSL)
or Renovate opens a PR for a system package update.

**Flow:**
1. Renovate (or manual trigger) opens PR with updated Dockerfile base image digest
2. Same build → validate → rollout flow as Scenario 1
3. If validation fails, PR is left open for manual review
4. Platform engineer investigates failure in test logs and either fixes the Dockerfile or reverts

**Acceptance Criteria:**
- CVE triggers a rebuild within 24 hours
- Build succeeds or fails with clear logs for diagnosis
- Validation failures block the rollout (image is NOT auto-promoted to :latest)
- Team is notified of failures in Slack with logs link

### Scenario 3: Build Failure (Bad Upstream Dependency)

**Trigger:** A transitive dependency has a broken preinstall script or
incompatible version constraint.

**Flow:**
1. Renovate opens PR
2. Build fails (Docker build step exits non-zero)
3. Failure is reported to Slack with build logs
4. PR remains open, tagged `buildkit-failed`
5. Platform engineer investigates (likely upstream issue)
6. Engineer either:
   - Pins version in package.json to avoid the bad release
   - Waits for upstream fix and retries
   - Updates Dockerfile to work around the issue

**Acceptance Criteria:**
- Build failure is detected within 5 minutes of build start
- Slack notification includes error snippet and logs link
- PR is not auto-closed (remains for manual intervention)
- Rollout is blocked (no new image pushed to GKE)
- Engineer can manually retry the build from the PR

### Scenario 4: Validation Test Fails

**Trigger:** New image builds successfully but a reference agent task fails.

**Flow:**
1. Image is built and tagged `:candidate-<commit-sha>`
2. Validation suite deploys a temporary pod with the candidate image
3. Pod runs 5 reference tasks (e.g., onboarding, gap-fill, implementation)
4. One task fails (e.g., model output parsing changed)
5. Validation reports failure to Slack with task logs
6. Image is NOT tagged `:latest` (rollout blocked)
7. PR remains open for engineer review

**Acceptance Criteria:**
- Validation runs automatically on every successful build
- Test failures include task name, logs, and error message
- Failed candidate images are still available in GCR (for manual inspection)
- Slack notification includes: image tag, failed task name, error snippet, logs link
- No rollout happens if validation fails

### Scenario 5: Scheduled Daily Build (Even if No Dependency Changes)

**Trigger:** Daily cron job at 2 AM UTC.

**Flow:**
1. Cron triggers container rebuild (no source changes)
2. Base image is refreshed from Docker Hub (latest patch of base OS)
3. Dependencies are reinstalled (lockfile is the same, but timestamps/build caches are fresh)
4. New image is tagged `:daily-<date>` and pushed
5. Validation suite runs
6. If all pass, image is also tagged `:latest`
7. Notification sent showing image is up-to-date

**Acceptance Criteria:**
- Daily build runs on schedule (every 24 hours ±5 min)
- Image is rebuilt even if source hasn't changed (freshness matters)
- Validation suite runs automatically
- Platform engineer sees a summary: "All passing, no changes to promote"

## Functional Requirements

### FR-1: Detect Upstream Changes

Renovate must be configured to monitor:
- `@anthropic-ai/sdk` (npm) in `agent/package.json` and `mcp-server/package.json`
- `node` (official base image) in `Dockerfile`
- All other npm, pip, or system packages configured to auto-patch
- Minor and patch versions; major versions require manual approval

**Testable:** Run `npm outdated` in CI and confirm Renovate opens a PR
within 5 minutes of a test npm package release.

### FR-2: Build Container on Dependency Change

When a Renovate PR merges or a manual rebuild trigger is invoked:

1. Clone the repo at the merge commit
2. Parse the `Dockerfile` to identify build stages
3. Run `docker build` with:
   - `--build-arg BUILDKIT_INLINE_CACHE=1` for layer caching
   - `--tag ghcr.io/re-cinq/claude-headless:<tag>` where tag is:
     - `claude-sdk-<version>` if change is SDK update
     - `node-<version>` if change is Node.js base image
     - `candidate-<commit-sha>` for temporary validation
     - `latest` after validation passes
4. Push to GCR with all tags
5. Update `k8s/agent-deployment.yaml` image reference if rollout is approved

**Testable:** Build the Dockerfile locally, confirm image layers are
cached on second build, and verify image is pushed to GCR with correct tags.

### FR-3: Validate New Image

Before rollout to production, run a validation suite on GKE:

1. Spin up a temporary namespace `claude-headless-validation-<commit-sha>`
2. Create a Pod with the candidate image and full agent permissions
3. Run 5 reference tasks in sequence:
   - **task-onboard**: onboard a test repo (mimics real onboarding flow)
   - **task-gap-fill**: generate missing documentation (API call mode)
   - **task-implementation**: implement from a spec (Claude Code mode)
   - **task-refactor**: refactor a code sample (multi-agent mode)
   - **task-review**: review a PR (simple API mode)
4. Collect metrics: success/fail, latency, cost, stderr
5. Compare metrics to baseline (prev `:latest` image)
6. If all tasks pass within acceptable variance (±20% latency), mark image as valid
7. If any task fails, mark as invalid and report
8. Clean up validation namespace

**Testable:** Deploy a candidate image to a staging pod, run one reference
task, and confirm it completes and metrics are recorded.

### FR-4: Gradual Rollout

After validation passes:

1. Trigger a deployment update:
   - Update `k8s/agent-deployment.yaml` image reference
   - Apply via `kubectl patch deployment` with `maxSurge: 1, maxUnavailable: 0`
2. Monitor rollout:
   - New replicas start with new image
   - Old replicas finish current tasks and gracefully terminate
   - No in-flight agent tasks are interrupted
3. Wait for rollout to complete (all replicas running new image)
4. Run a smoke test on the live cluster (one quick task)
5. If smoke test fails, trigger rollback to previous `:latest`

**Testable:** Update image reference in deployment, watch `kubectl rollout status`,
confirm old and new replicas coexist during rollout.

### FR-5: Observability & Alerting

Log all rebuild steps to a centralized log store (Cloud Logging):

- Build start/end times, commit SHA, trigger reason
- Build success/failure with exit code
- Image tag, size, layers, push time
- Validation task results (pass/fail, latency, cost)
- Rollout start/end, Pod events, errors
- Any manual overrides or rollbacks

**Slack notifications** for:
- Build started (quiet, background)
- Build completed (success: image tag; failure: error snippet + logs link)
- Validation started (quiet)
- Validation completed (summary: N/5 tasks passed, latency vs baseline)
- Rollout started (quiet)
- Rollout completed (success: new image tag, previous tag; failure: rollback reason)
- Validation or rollout failures (loud, mentions @platform-eng)

**Testable:** Build the image, check Cloud Logging for all events,
and confirm Slack message is sent within 1 minute of completion.

### FR-6: Manual Rebuild Trigger

Platform engineer must be able to manually trigger a rebuild without
waiting for Renovate:

- Web UI button on settings page: "Rebuild Claude Headless Image"
- CLI command: `lore rebuild-container --image claude-headless`
- Trigger logs reason (platform engineer comment)
- Follows same build → validate → rollout flow

**Testable:** Click the button, confirm build starts within 30 seconds.

### FR-7: Rollback & Rescue

If a live image is bad (e.g., validation was too lenient or a new task
type breaks):

1. Platform engineer can immediately rollback via button or CLI:
   - `lore rollback-container --image claude-headless --to previous`
2. Deployment rolls back to previous `:latest`
3. Notification sent to Slack with rollback reason

**Testable:** Deploy a broken image intentionally, trigger rollback,
confirm deployment reverts.

## Non-Functional Requirements

### NFR-1: Build Performance

- Full rebuild (clean): <30 minutes
- Incremental rebuild (Docker cache hit): <5 minutes
- Image push to registry: <2 minutes
- Validation suite: <15 minutes (5 tasks in sequence)
- Rollout: <10 minutes (zero-downtime, max 1 minute per replica)

### NFR-2: Security

- All container images are signed (Sigstore cosign)
- SBOMs (software bill of materials) generated and stored
- No credentials baked into image (env vars, mounted secrets only)
- Base image must be scanned for vulnerabilities before push
- Rollback must not require manual intervention to restore previous image

### NFR-3: Reliability

- Build can be retried idempotently (same inputs → same image)
- Validation suite is deterministic (no random test data)
- If validation hangs, timeout after 20 minutes per task
- Rollout uses Kubernetes native mechanisms (Deployment strategy)
- No single point of failure (can rebuild and deploy without central orchestrator)

### NFR-4: Cost Optimization

- Docker layer caching minimizes rebuild time
- Validation pods are temporary and cleaned up immediately
- Only images that pass validation are kept in GCR (failed candidates cleaned up after 7 days)
- Validation reuses same cluster (no separate staging environment needed)

### NFR-5: Auditability

- All builds logged with commit SHA, timestamp, trigger reason
- All rollouts logged with before/after image tags
- All manual interventions (rollback, retry) logged with engineer name
- Metrics stored in PostgreSQL for trend analysis

## Out of Scope

This specification does NOT include:

- **Multi-image orchestration** (rebuilding multiple images in a single workflow)
- **Canary deployments** (rolling out to a subset of agents first) — we use simple blue-green
- **A/B testing** of images (comparing two versions' performance on identical tasks)
- **Automatic major version upgrades** (major versions require manual ADR + testing)
- **Custom validation logic per repo** (validation suite is fixed, org-wide)
- **Image promotion to multiple registries** (only GCR)
- **Rebuild of downstream images** (only `claude-headless` is in scope; other images are rebuilt separately)
- **Per-team image customization** (all teams use the same `claude-headless` image)

## Key Entities

### BuildConfig (new)

Stored in `lore.build_configs` table:

```
{
  id: UUID,
  image_name: "claude-headless" | "mcp-server" | ... (enum),
  trigger_type: "renovate" | "schedule" | "manual" (enum),
  dockerfile_path: "Dockerfile" (string),
  build_context: "." (string),
  base_image: "node:22-bookworm-slim" (string),
  registry: "ghcr.io/re-cinq" (string),
  enabled: true (boolean),
  created_at: timestamp,
  updated_at: timestamp,
}
```

### BuildRun (new)

Stored in `lore.build_runs` table:

```
{
  id: UUID,
  config_id: FK -> build_configs.id,
  trigger_reason: "renovate-pr-merged" | "manual" | "schedule" (string),
  trigger_commit_sha: string,
  trigger_pr_number: integer (nullable),
  status: "pending" | "building" | "built" | "validating" | "validated" | "rolling_out" | "rolled_back" | "failed" (enum),
  image_tag: "candidate-abc123" | "claude-sdk-0.25.0" (string),
  image_digest: string (sha256),
  image_size_bytes: integer,
  build_started_at: timestamp,
  build_ended_at: timestamp,
  build_duration_seconds: integer,
  build_logs_url: string,
  validation_started_at: timestamp,
  validation_ended_at: timestamp,
  validation_status: "passed" | "failed" (enum, nullable),
  validation_logs_url: string (nullable),
  rollout_started_at: timestamp,
  rollout_ended_at: timestamp,
  rollout_status: "pending" | "in_progress" | "completed" | "rolled_back" (enum),
  rollout_logs_url: string (nullable),
  error_message: string (nullable),
  created_at: timestamp,
  updated_at: timestamp,
}
```

### ValidationTask (new)

Stored in `lore.validation_tasks` table:

```
{
  id: UUID,
  build_run_id: FK -> build_runs.id,
  task_name: "task-onboard" | "task-gap-fill" | ... (enum),
  task_status: "pending" | "running" | "passed" | "failed" (enum),
  started_at: timestamp,
  ended_at: timestamp,
  duration_seconds: integer,
  logs_url: string,
  stderr_snippet: string (first 500 chars of error, nullable),
  metrics: {
    latency_ms: integer,
    cost_usd: decimal,
    token_count: integer,
  } (JSON),
  created_at: timestamp,
}
```

### Deployment (existing, updated)

Kubernetes Deployment `lore-agent` in `lore-agent` namespace.
Updated by build pipeline:

```yaml
spec:
  template:
    spec:
      containers:
      - name: agent
        image: ghcr.io/re-cinq/claude-headless:<new-tag>
        # ... rest unchanged
```

## Success Criteria

### Measurable Outcomes

1. **Deployment frequency**: New Claude SDK versions are deployed to production within 4 hours of release (vs. manual: 1-2 weeks)

2. **Security patch lag**: Security patches for base OS are deployed within 24 hours of Renovate PR merge (vs. manual: indefinite)

3. **Build reliability**: 95%+ of builds that are triggered succeed (only failures due to upstream breakage)

4. **Validation effectiveness**: Zero production incidents caused by image incompatibility post-rollout (baseline: currently unknown, likely >0)

5. **Rollout safety**: Zero in-flight agent tasks interrupted due to image rollout (graceful termination)

6. **Observability**: All builds, validations, and rollouts logged; platform engineer can reconstruct what happened in any incident within 5 minutes of Slack notification

7. **MTTR**: Platform engineer can identify and fix a broken build or rollout within 30 minutes (via Slack notification + logs)

8. **Cost efficiency**: Total CI/CD cost for rebuild pipeline <$50/month (validation + storage)

### Timeline

- **Week 1**: Set up Renovate config, build pipeline in GitHub Actions
- **Week 2**: Implement validation suite, image tagging strategy
- **Week 3**: Implement rollout automation, monitoring, and alerting

## Assumptions

1. **Renovate is already available** — The team has already evaluated and chosen Renovate (or an equivalent dependency scanner) as the mechanism to detect upstream changes.

2. **GitHub Actions is the CI/CD platform** — Builds and validation run in GitHub Actions (already in use for Lore repo CI).

3. **GKE is the deployment target** — The Lore Agent runs on GKE; rollouts use `kubectl` and Kubernetes native mechanisms (Deployment rolling updates).

4. **PostgreSQL is available for audit logs** — The existing `lore` database can store `build_runs`, `validation_tasks`, and `build_configs` tables.

5. **Slack webhook is configured** — The Lore Agent service can send notifications to a Slack webhook (already used by other agents).

6. **Reference tasks are deterministic** — The 5 validation tasks (onboard, gap-fill, implementation, refactor, review) produce consistent output and latency when run against the same inputs.

7. **Claude SDK and Node.js upgrades are generally backward-compatible** — Major version breaking changes are rare enough that policy can be "auto-patch minor/patch, manual approval for major."

8. **No air-gapped deployments** — The container can pull base images from Docker Hub and dependencies from npm/PyPI without proxy configuration (team is okay with public internet access for builds).

9. **Platform engineer has time to review failures** — Validation failures and rollback events create work for the platform team; this is acceptable overhead.

10. **Graceful termination is sufficient** — Agents can tolerate a 30-60 second delay for pod eviction; we don't need to checkpoint agent state across restarts.